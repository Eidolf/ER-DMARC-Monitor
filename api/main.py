import os
import gzip
import zipfile
import io
import traceback
import sys
import json
from datetime import datetime
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlmodel import Session, create_engine, SQLModel, select, func
from pydantic import BaseModel
from defusedxml import ElementTree as ET

from models import Domain, ReportMetadata, ReportRecord, User, UserRole
from auth import (
    get_password_hash, verify_password, create_access_token, create_mfa_token,
    verify_totp, get_current_user, RoleChecker, get_session
)
import entra

DB_DSN = os.getenv("DB_DSN", "sqlite:///database.db")
engine = create_engine(DB_DSN)

app = FastAPI(title="DMARC Monitoring API")

@app.middleware("http")
async def db_session_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        print(f"CRITICAL ERROR: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.on_event("startup")
def on_startup():
    import time
    for _ in range(5):
        try:
            SQLModel.metadata.create_all(engine)
            with Session(engine) as session:
                # Bootstrap admin user if none exists
                admin_exists = session.exec(select(User).where(User.role == UserRole.ADMIN)).first()
                if not admin_exists:
                    admin_user = User(
                        email=os.getenv("ADMIN_EMAIL", "admin@example.com"),
                        username=os.getenv("ADMIN_USER", "admin"),
                        hashed_password=get_password_hash(os.getenv("ADMIN_PASSWORD", "admin123")),
                        role=UserRole.ADMIN,
                        is_active=True
                    )
                    session.add(admin_user)
                
                # Bootstrap system settings
                settings_exist = session.exec(select(SystemSettings)).first()
                if not settings_exist:
                    settings = SystemSettings(
                        entra_tenant_id=os.getenv("ENTRA_TENANT_ID"),
                        entra_client_id=os.getenv("ENTRA_CLIENT_ID"),
                        entra_client_secret=os.getenv("ENTRA_CLIENT_SECRET"),
                        entra_tenant_type=os.getenv("ENTRA_TENANT_TYPE", "common")
                    )
                    session.add(settings)
                session.commit()
            break
        except Exception:
            time.sleep(2)

def log_audit(session: Session, user_id: int, ip: str, method: str, status: str, detail: str = None):
    audit = LoginAudit(user_id=user_id, ip_address=ip, method=method, status=status, detail=detail)
    session.add(audit)
    session.commit()

# --- Settings & Admin Endpoints ---

@app.get("/settings/global")
def get_global_settings(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    settings = session.exec(select(SystemSettings)).first()
    # Mask the client secret
    if settings.entra_client_secret:
        settings.entra_client_secret = "********"
    return settings

@app.post("/settings/global")
def update_global_settings(
    new_settings: SystemSettings,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    db_settings = session.exec(select(SystemSettings)).first()
    update_data = new_settings.dict(exclude_unset=True)
    
    # Don't overwrite secret if it was masked in the UI
    if update_data.get("entra_client_secret") == "********":
        del update_data["entra_client_secret"]
        
    for key, value in update_data.items():
        setattr(db_settings, key, value)
    
    session.add(db_settings)
    session.commit()
    session.refresh(db_settings)
    return db_settings

@app.get("/settings/branding")
def get_branding(session: Session = Depends(get_session)):
    settings = session.exec(select(SystemSettings)).first()
    return {
        "title_part1": settings.title_part1,
        "title_part2": settings.title_part2,
        "color_part1": settings.color_part1,
        "color_part2": settings.color_part2,
        "logo_url": settings.logo_url
    }

@app.get("/admin/audit")
def get_audit_logs(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    # Join with User to get emails
    statement = select(LoginAudit, User.email).join(User).order_by(LoginAudit.timestamp.desc()).limit(100)
    results = session.exec(statement).all()
    return [{"id": a.id, "email": email, "timestamp": a.timestamp, "ip": a.ip_address, "method": a.method, "status": a.status, "detail": a.detail} for a, email in results]

# --- Profile Endpoints ---

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

@app.post("/auth/profile/password")
def change_password(
    req: PasswordChangeRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    if user.sso_provider:
        raise HTTPException(status_code=400, detail="SSO users cannot change password locally")
    
    if not verify_password(req.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid old password")
    
    user.hashed_password = get_password_hash(req.new_password)
    session.add(user)
    session.commit()
    return {"status": "success"}

@app.post("/auth/profile/mfa/setup")
def setup_mfa(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    import auth
    secret = auth.generate_totp_secret()
    user.mfa_secret = secret
    uri = auth.get_totp_uri(secret, user.email)
    session.add(user)
    session.commit()
    return {"secret": secret, "uri": uri}

@app.post("/auth/profile/mfa/enable")
def enable_mfa(
    code: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    if not user.mfa_secret or not verify_totp(user.mfa_secret, code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    
    user.mfa_enabled = True
    # Generate recovery codes
    import secrets
    import json
    codes = [secrets.token_hex(4) for _ in range(8)]
    user.mfa_recovery_codes = json.dumps(codes)
    
    session.add(user)
    session.commit()
    return {"recovery_codes": codes}

@app.get("/auth/profile/activity")
def get_activity(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    audits = session.exec(select(LoginAudit).where(LoginAudit.user_id == user.id).order_by(LoginAudit.timestamp.desc()).limit(10)).all()
    return audits

# --- Updated Authentication Endpoints ---

@app.post("/auth/login")
def login(req: LoginRequest, request: Request, session: Session = Depends(get_session)):
    client_ip = request.client.host
    user = session.exec(select(User).where(User.username == req.username)).first()
    
    if not user or not user.hashed_password or not verify_password(req.password, user.hashed_password):
        if user: log_audit(session, user.id, client_ip, "local", "failed", "Invalid password")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.is_active:
        log_audit(session, user.id, client_ip, "local", "failed", "Account disabled")
        raise HTTPException(status_code=401, detail="Account disabled")

    settings = session.exec(select(SystemSettings)).first()
    if not settings.allow_local_login and user.role != UserRole.ADMIN:
        log_audit(session, user.id, client_ip, "local", "failed", "Local login disabled")
        raise HTTPException(status_code=403, detail="Local login is currently disabled")

    # MFA Enforcement Check
    mfa_required = (user.role == UserRole.ADMIN and settings.enforce_mfa_admins) or \
                   (user.role == UserRole.ANALYST and settings.enforce_mfa_analysts)
    
    if mfa_required and user.mfa_enabled:
        log_audit(session, user.id, client_ip, "local", "mfa_pending")
        temp_token = create_mfa_token({"sub": str(user.id)})
        return {"mfa_required": True, "mfa_token": temp_token}
    
    user.last_login = datetime.utcnow()
    user.last_login_ip = client_ip
    user.last_login_method = "local"
    log_audit(session, user.id, client_ip, "local", "success")
    session.add(user)
    session.commit()

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "role": user.role,
        "mfa_setup_required": mfa_required and not user.mfa_enabled
    }

class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: str

@app.post("/auth/mfa/verify")
def verify_mfa(req: MFAVerifyRequest, request: Request, session: Session = Depends(get_session)):
    from jose import jwt
    from auth import SECRET_KEY, ALGORITHM
    client_ip = request.client.host
    try:
        payload = jwt.decode(req.mfa_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not payload.get("mfa_pending") or not user_id:
            raise HTTPException(status_code=401, detail="Invalid MFA token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid MFA token")
        
    user = session.get(User, int(user_id))
    if not user or not user.mfa_secret or not verify_totp(user.mfa_secret, req.code):
        log_audit(session, user.id if user else 0, client_ip, "mfa", "failed", "Invalid MFA code")
        raise HTTPException(status_code=401, detail="Invalid MFA code")
    
    user.last_login = datetime.utcnow()
    user.last_login_ip = client_ip
    user.last_login_method = "local" # Still local method but MFA verified
    log_audit(session, user.id, client_ip, "mfa", "success")
    session.add(user)
    session.commit()

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role}

@app.get("/auth/sso/login")
def sso_login(session: Session = Depends(get_session)):
    settings = session.exec(select(SystemSettings)).first()
    if not settings.allow_sso_login:
        raise HTTPException(status_code=403, detail="SSO login is currently disabled")
    
    url = entra.get_auth_url()
    if not url:
        raise HTTPException(status_code=501, detail="SSO not configured")
    return RedirectResponse(url)

@app.get("/auth/sso/callback")
def sso_callback(code: str, request: Request, session: Session = Depends(get_session)):
    client_ip = request.client.host
    result = entra.acquire_token_by_code(code)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result.get("error_description"))
    
    claims = result.get("id_token_claims")
    user_info = entra.validate_id_token(claims)
    
    # Find or create user
    user = session.exec(select(User).where(User.sso_id == user_info["sso_id"])).first()
    if not user:
        # Fallback to email if OID doesn't match yet
        user = session.exec(select(User).where(User.email == user_info["email"])).first()
        if user:
            user.sso_id = user_info["sso_id"]
            user.sso_provider = "entra"
        else:
            # Create new user via SSO
            user = User(
                email=user_info["email"],
                username=user_info["email"],
                role=UserRole.READ_ONLY, # Default role
                is_active=True,
                sso_id=user_info["sso_id"],
                sso_provider="entra"
            )
            session.add(user)
    
    user.last_login = datetime.utcnow()
    user.last_login_ip = client_ip
    user.last_login_method = "entra"
    log_audit(session, user.id, client_ip, "entra", "success")
    session.add(user)
    session.commit()
    session.refresh(user)
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    # Redirect back to frontend with token
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:13060")
    return RedirectResponse(f"{frontend_url}/?token={access_token}&role={user.role}")

@app.get("/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "mfa_enabled": user.mfa_enabled
    }

# --- Domain & Report Endpoints (Protected) ---

class DomainCreate(BaseModel):
    name: str
    dmarc_policy: str = "none"

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/domains")
def create_domain(
    domain: DomainCreate, 
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    existing = session.exec(select(Domain).where(Domain.name == domain.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists")
    db_domain = Domain(name=domain.name, dmarc_policy=domain.dmarc_policy)
    session.add(db_domain)
    session.commit()
    session.refresh(db_domain)
    return db_domain

@app.get("/domains")
def get_domains(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    return session.exec(select(Domain)).all()

@app.delete("/domains/{domain_id}")
def delete_domain(
    domain_id: int, 
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    domain = session.get(Domain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    session.delete(domain)
    session.commit()
    return {"status": "success"}

@app.get("/domains/{domain_name}/records")
def get_domain_records(
    domain_name: str, 
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    # Case-insensitive join and filter
    statement = (
        select(ReportRecord)
        .join(ReportMetadata)
        .where(func.lower(ReportMetadata.domain_name) == domain_name.lower())
        .order_by(ReportMetadata.date_end.desc())
    )
    results = session.exec(statement).all()
    
    return [
        {
            "id": r.id,
            "source_ip": r.source_ip,
            "count": r.count,
            "disposition": r.disposition,
            "dkim_pass": r.dkim_pass,
            "spf_pass": r.spf_pass,
            "dkim_auth_details": json.loads(r.dkim_auth_results or "[]"),
            "spf_auth_details": json.loads(r.spf_auth_results or "[]"),
            "report_id": r.report.report_id,
            "org_name": r.report.org_name,
            "date": r.report.date_end.isoformat()
        }
        for r in results
    ]

@app.get("/reports/stats")
def get_report_stats(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    records = session.exec(select(ReportRecord)).all()
    total_analyzed = sum(r.count for r in records)
    spf_failures = sum(r.count for r in records if not r.spf_pass)
    dkim_failures = sum(r.count for r in records if not r.dkim_pass)
    unauthorized_senders = len(set(r.source_ip for r in records if not r.spf_pass and not r.dkim_pass))
    
    return {
        "total_analyzed": total_analyzed,
        "spf_failures": spf_failures,
        "dkim_failures": dkim_failures,
        "unauthorized_senders": unauthorized_senders
    }

@app.post("/reports/upload")
async def upload_reports(
    files: list[UploadFile] = File(...), 
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN, UserRole.ANALYST]))
):
    results = []
    for file in files:
        content = await file.read()
        try:
            if file.filename.endswith('.gz'):
                xml_data = gzip.decompress(content)
            elif file.filename.endswith('.zip'):
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    xml_files = [n for n in z.namelist() if n.endswith('.xml')]
                    if not xml_files: continue
                    xml_data = z.read(xml_files[0])
            else:
                xml_data = content
                
            root = ET.fromstring(xml_data)
            metadata = root.find("report_metadata")
            if metadata is None: continue
                
            report_id = metadata.findtext("report_id")
            existing = session.exec(select(ReportMetadata).where(ReportMetadata.report_id == report_id)).first()
            if existing:
                results.append({"filename": file.filename, "status": "skipped"})
                continue
                
            report = ReportMetadata(
                org_name=metadata.findtext("org_name"),
                email=metadata.findtext("email"),
                report_id=report_id,
                date_begin=datetime.fromtimestamp(int(metadata.find("date_range").findtext("begin"))),
                date_end=datetime.fromtimestamp(int(metadata.find("date_range").findtext("end"))),
                domain_name=root.find("policy_published").findtext("domain") or "unknown"
            )
            session.add(report)
            session.flush()
            
            for record in root.findall("record"):
                row = record.find("row")
                source_ip = row.findtext("source_ip")
                count = int(row.findtext("count"))
                disposition = row.find("policy_evaluated").findtext("disposition")
                
                auth_results = record.find("auth_results")
                
                dkim_res_list = []
                for d in auth_results.findall("dkim"):
                    dkim_res_list.append({
                        "domain": d.findtext("domain"),
                        "selector": d.findtext("selector"),
                        "result": d.findtext("result"),
                        "human_result": d.findtext("human_result")
                    })
                    
                spf_res_list = []
                for s in auth_results.findall("spf"):
                    spf_res_list.append({
                        "domain": s.findtext("domain"),
                        "result": s.findtext("result"),
                        "scope": s.findtext("scope")
                    })

                dkim_pass = any(d["result"] == "pass" for d in dkim_res_list)
                spf_pass = any(s["result"] == "pass" for s in spf_res_list)
                        
                r = ReportRecord(
                    report_id=report.id,
                    source_ip=source_ip,
                    count=count,
                    disposition=disposition,
                    dkim_pass=dkim_pass,
                    spf_pass=spf_pass,
                    dkim_auth_results=json.dumps(dkim_res_list),
                    spf_auth_results=json.dumps(spf_res_list)
                )
                session.add(r)
            
            results.append({"filename": file.filename, "status": "success"})
            
        except Exception as e:
            results.append({"filename": file.filename, "status": "error", "detail": str(e)})
            
    session.commit()
    return {"results": results}

