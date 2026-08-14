import os
import gzip
import zipfile
import io
import traceback
import sys
import json
import uuid
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, Request, status, Query
from fastapi.responses import JSONResponse, RedirectResponse
from sqlmodel import Session, create_engine, SQLModel, select, func
from pydantic import BaseModel
from defusedxml import ElementTree as ET
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from models import (
    Domain, ReportMetadata, ReportRecord, User, UserRole, SystemSettings, LoginAudit, AuthSource,
    SMTPListeningDomain, SMTPRecipient, SystemProcessingLog
)
from auth import (
    get_password_hash, verify_password, create_access_token, create_mfa_token,
    verify_totp, get_current_user, RoleChecker, get_session
)
import entra
import dns_utils
import ip_utils
from fastapi import BackgroundTasks
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_client = redis.from_url(REDIS_URL)

def normalize_end_date(end_date_str: str) -> datetime:
    parsed_end = datetime.fromisoformat(end_date_str)
    if parsed_end.time() == datetime.min.time():
        parsed_end = datetime.combine(parsed_end.date(), datetime.max.time())
    return parsed_end

def log_system_event(
    session: Session,
    component: str,
    level: str,
    event_type: str,
    message: str,
    details: str | None = None,
    is_test: bool = False
) -> None:
    try:
        log_entry = SystemProcessingLog(
            component=component,
            level=level,
            event_type=event_type,
            message=message,
            details=details,
            is_test=is_test
        )
        session.add(log_entry)
        session.commit()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        try:
            session.rollback()
        except Exception:
            traceback.print_exc(file=sys.stderr)

def sync_smtp_config(session: Session) -> None:
    # Clear existing
    try:
        keys = r_client.keys("smtp:allowed:*")
        if keys:
            r_client.delete(*keys)
    except Exception:
        traceback.print_exc(file=sys.stderr)

    
    domains = session.exec(select(SMTPListeningDomain).where(SMTPListeningDomain.is_active == True)).all()
    for d in domains:
        r_client.sadd("smtp:allowed:domains", d.domain_name.lower())
        recipients = session.exec(select(SMTPRecipient).where(SMTPRecipient.listening_domain_id == d.id, SMTPRecipient.is_active == True)).all()
        for rec in recipients:
            r_client.sadd(f"smtp:allowed:recipients:{d.domain_name.lower()}", rec.local_part.lower())
            
    # Add test recipients
    settings = session.exec(select(SystemSettings)).first()
    if settings and settings.allowed_test_recipients:
        for addr in settings.allowed_test_recipients.split(","):
            addr = addr.strip()
            if "@" in addr:
                local_part, domain = addr.split("@", 1)
                r_client.sadd("smtp:allowed:domains", domain.lower())
                r_client.sadd(f"smtp:allowed:recipients:{domain.lower()}", local_part.lower())
    
    log_system_event(
        session,
        component="backend",
        level="INFO",
        event_type="smtp_sync",
        message=f"Synchronized SMTP inbound configuration for {len(domains)} active domains."
    )


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
    from sqlalchemy import text
    for _ in range(5):
        try:
            SQLModel.metadata.create_all(engine)
            with Session(engine) as session:
                # Simple migration for missing columns
                try:
                    session.execute(text("ALTER TABLE systemsettings ADD COLUMN IF NOT EXISTS default_sso_role VARCHAR"))
                    session.execute(text("ALTER TABLE systemsettings ADD COLUMN IF NOT EXISTS public_url VARCHAR"))
                    session.commit()
                except Exception as e:
                    print(f"Migration notice (already exists?): {e}")
                    session.rollback()

                # Bootstrap admin user if none exists
                admin_exists = session.exec(select(User).where(User.role == UserRole.ADMIN)).first()
                if not admin_exists:
                    admin_user = User(
                        email=os.getenv("ADMIN_EMAIL", "admin@local"),
                        username=os.getenv("ADMIN_USER", "admin"),
                        hashed_password=get_password_hash(os.getenv("ADMIN_PASSWORD", "admin123")),
                        role=UserRole.ADMIN,
                        is_active=True,
                        auth_source=AuthSource.LOCAL
                    )
                    session.add(admin_user)
                else:
                    # Migration logic: admin@example.com -> admin@local
                    legacy_admin = session.exec(select(User).where(User.email == "admin@example.com")).first()
                    if legacy_admin:
                        legacy_admin.email = "admin@local"
                        legacy_admin.auth_source = AuthSource.LOCAL
                        session.add(legacy_admin)
                
                # Bootstrap system settings
                settings = session.exec(select(SystemSettings)).first()
                if not settings:
                    settings = SystemSettings(
                        entra_tenant_id=os.getenv("ENTRA_TENANT_ID"),
                        entra_client_id=os.getenv("ENTRA_CLIENT_ID"),
                        entra_client_secret=os.getenv("ENTRA_CLIENT_SECRET"),
                        entra_tenant_type=os.getenv("ENTRA_TENANT_TYPE", "single"),
                        public_url=os.getenv("FRONTEND_URL") or os.getenv("ENTRA_REDIRECT_URI", "").split("/api/")[0]
                    )
                    session.add(settings)
                else:
                    # Update missing values from env if possible
                    if not settings.public_url:
                        settings.public_url = os.getenv("FRONTEND_URL") or os.getenv("ENTRA_REDIRECT_URI", "").split("/api/")[0]
                        session.add(settings)
                session.commit()
                sync_smtp_config(session)
            break
        except Exception:
            time.sleep(2)

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # X-Forwarded-For can contain comma-separated IPs (client, proxy1, proxy2...)
        client_ip = forwarded.split(",")[0].strip()
        if client_ip:
            return client_ip
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        cleaned_real_ip = real_ip.strip()
        if cleaned_real_ip:
            return cleaned_real_ip
    if hasattr(request, "client") and request.client and getattr(request.client, "host", None):
        return request.client.host
    return "unknown"

def log_audit(session: Session, user_id: int, ip: str, method: str, status: str, detail: str = None):
    audit = LoginAudit(user_id=user_id, ip_address=ip, method=method, status=status, detail=detail)
    session.add(audit)
    session.commit()

# --- Settings & Admin Endpoints ---

@app.patch("/settings/branding")
def update_branding(
    update: dict,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    settings = session.exec(select(SystemSettings)).first()
    for key, value in update.items():
        if hasattr(settings, key):
            setattr(settings, key, value)
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings

# --- SMTP Inbound Endpoints ---

class ListeningDomainCreate(BaseModel):
    domain_name: str

class RecipientCreate(BaseModel):
    local_part: str

@app.get("/admin/smtp/inbound")
def get_smtp_inbound_config(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    domains = session.exec(select(SMTPListeningDomain)).all()
    results = []
    for d in domains:
        recipients = session.exec(select(SMTPRecipient).where(SMTPRecipient.listening_domain_id == d.id)).all()
        results.append({
            "id": d.id,
            "domain_name": d.domain_name,
            "is_active": d.is_active,
            "recipients": recipients
        })
    return results

@app.post("/admin/smtp/inbound/domains")
def add_listening_domain(
    domain: ListeningDomainCreate,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    existing = session.exec(select(SMTPListeningDomain).where(SMTPListeningDomain.domain_name == domain.domain_name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists")
    db_domain = SMTPListeningDomain(domain_name=domain.domain_name)
    session.add(db_domain)
    session.commit()
    sync_smtp_config(session)
    return db_domain

@app.patch("/admin/smtp/inbound/domains/{domain_id}")
def update_listening_domain(
    domain_id: int,
    update: dict,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    domain = session.get(SMTPListeningDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    for key, value in update.items():
        if hasattr(domain, key):
            setattr(domain, key, value)
    session.add(domain)
    session.commit()
    sync_smtp_config(session)
    return domain

@app.delete("/admin/smtp/inbound/domains/{domain_id}")
def delete_listening_domain(
    domain_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    domain = session.get(SMTPListeningDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    # Delete recipients first
    recipients = session.exec(select(SMTPRecipient).where(SMTPRecipient.listening_domain_id == domain_id)).all()
    for r in recipients:
        session.delete(r)
    session.delete(domain)
    session.commit()
    sync_smtp_config(session)
    return {"status": "success"}

@app.post("/admin/smtp/inbound/domains/{domain_id}/recipients")
def add_recipient(
    domain_id: int,
    recipient: RecipientCreate,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    domain = session.get(SMTPListeningDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    
    existing = session.exec(select(SMTPRecipient).where(
        SMTPRecipient.listening_domain_id == domain_id,
        SMTPRecipient.local_part == recipient.local_part
    )).first()
    if existing:
        raise HTTPException(status_code=400, detail="Recipient already exists")
        
    db_recipient = SMTPRecipient(listening_domain_id=domain_id, local_part=recipient.local_part)
    session.add(db_recipient)
    session.commit()
    sync_smtp_config(session)
    return db_recipient

@app.delete("/admin/smtp/inbound/recipients/{recipient_id}")
def delete_recipient(
    recipient_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    recipient = session.get(SMTPRecipient, recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    session.delete(recipient)
    session.commit()
    sync_smtp_config(session)
    return {"status": "success"}

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
    sync_smtp_config(session)
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
    # Join with User to get emails - strictly Admin only
    statement = select(LoginAudit, User.email).join(User).order_by(LoginAudit.timestamp.desc()).limit(100)
    results = session.exec(statement).all()
    return [{"id": a.id, "email": email, "timestamp": a.timestamp, "ip": a.ip_address, "method": a.method, "status": a.status, "detail": a.detail} for a, email in results]

@app.get("/admin/system-logs")
def get_system_processing_logs(
    component: str | None = Query(default=None),
    level: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN, UserRole.ANALYST]))
):
    statement = select(SystemProcessingLog)
    if component:
        statement = statement.where(SystemProcessingLog.component == component)
    if level:
        statement = statement.where(SystemProcessingLog.level == level)
    if event_type:
        statement = statement.where(SystemProcessingLog.event_type == event_type)
    if search:
        statement = statement.where(SystemProcessingLog.message.contains(search))
        
    statement = statement.order_by(SystemProcessingLog.timestamp.desc()).limit(limit)
    logs = session.exec(statement).all()
    return logs


# --- User Management Endpoints ---

class UserCreate(BaseModel):
    email: str
    username: str
    password: str
    role: UserRole

class UserUpdate(BaseModel):
    email: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None

@app.get("/admin/users")
def get_users(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    return session.exec(select(User)).all()

@app.post("/admin/users")
def create_user(
    new_user: UserCreate,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    # Ensure @local for local users
    if not new_user.email.endswith("@local"):
        raise HTTPException(status_code=400, detail="Local users must use the @local domain")
        
    existing = session.exec(select(User).where(User.email == new_user.email)).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
        
    db_user = User(
        email=new_user.email,
        username=new_user.username,
        hashed_password=get_password_hash(new_user.password),
        role=new_user.role,
        auth_source=AuthSource.LOCAL
    )
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

@app.patch("/admin/users/{user_id}")
def update_user(
    user_id: int,
    update: UserUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if db_user.id == user.id and update.role and update.role != UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="You cannot remove your own Admin role")

    if update.email is not None:
        if db_user.auth_source == AuthSource.LOCAL and not update.email.endswith("@local"):
             raise HTTPException(status_code=400, detail="Local users must use the @local domain")
        db_user.email = update.email
    if update.role is not None:
        db_user.role = update.role
    if update.is_active is not None:
        # Prevent disabling the last admin
        if not update.is_active and db_user.role == UserRole.ADMIN:
            admins = session.exec(select(User).where(User.role == UserRole.ADMIN, User.is_active == True)).all()
            if len(admins) <= 1:
                raise HTTPException(status_code=400, detail="Cannot disable the last active Admin")
        db_user.is_active = update.is_active
        
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

@app.post("/admin/users/{user_id}/reset-mfa")
def reset_user_mfa(
    user_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db_user.mfa_enabled = False
    db_user.mfa_secret = None
    db_user.mfa_recovery_codes = None
    session.add(db_user)
    session.commit()
    return {"status": "success"}

@app.delete("/admin/users/{user_id}")
def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
        
    session.delete(db_user)
    session.commit()
    return {"status": "success"}

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

class LoginRequest(BaseModel):
    username: str
    password: str

class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: str

@app.post("/auth/login")
def login(req: LoginRequest, request: Request, session: Session = Depends(get_session)):
    client_ip = get_client_ip(request)
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
    client_ip = get_client_ip(request)
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
def sso_login(request: Request, session: Session = Depends(get_session)):
    settings = session.exec(select(SystemSettings)).first()
    if not settings.allow_sso_login:
        raise HTTPException(status_code=403, detail="SSO login is currently disabled")
    
    # Calculate redirect URI: 1. Settings DB, 2. Env Var, 3. Dynamic from request
    redirect_uri = os.getenv("ENTRA_REDIRECT_URI")
    if not redirect_uri:
        base = settings.public_url
        if not base:
            # Fallback to reconstructing from request
            # Check X-Forwarded-Host first (standard for reverse proxies)
            host = request.headers.get("x-forwarded-host") or request.headers.get("host")
            scheme = request.headers.get("x-forwarded-proto", "http")
            base = f"{scheme}://{host}"
        
        # Ensure no trailing slash in base
        base = base.rstrip("/")
        redirect_uri = f"{base}/api/auth/sso/callback"

    # For single tenant, we must use the actual tenant ID GUID
    tenant_id = settings.entra_tenant_type
    if tenant_id == "single":
        tenant_id = settings.entra_tenant_id

    url = entra.get_auth_url(
        client_id=settings.entra_client_id,
        client_secret=settings.entra_client_secret,
        tenant_id=tenant_id,
        redirect_uri=redirect_uri
    )
    if not url:
        raise HTTPException(status_code=501, detail="SSO not configured in Global Settings")
    return RedirectResponse(url)

@app.get("/auth/sso/callback")
def sso_callback(code: str, request: Request, session: Session = Depends(get_session)):
    client_ip = get_client_ip(request)
    settings = session.exec(select(SystemSettings)).first()
    
    redirect_uri = os.getenv("ENTRA_REDIRECT_URI")
    if not redirect_uri:
        base = settings.public_url
        if not base:
            host = request.headers.get("x-forwarded-host") or request.headers.get("host")
            scheme = request.headers.get("x-forwarded-proto", "http")
            base = f"{scheme}://{host}"
        
        base = base.rstrip("/")
        redirect_uri = f"{base}/api/auth/sso/callback"

    tenant_id = settings.entra_tenant_type
    if tenant_id == "single":
        tenant_id = settings.entra_tenant_id

    result = entra.acquire_token_by_code(
        code,
        client_id=settings.entra_client_id,
        client_secret=settings.entra_client_secret,
        tenant_id=tenant_id,
        redirect_uri=redirect_uri
    )
    if not result or "error" in result:
        raise HTTPException(status_code=400, detail=result.get("error_description") if result else "Failed to acquire token")
    
    claims = result.get("id_token_claims")
    user_info = entra.validate_id_token(claims)
    
    # Find or create user
    user = session.exec(select(User).where(User.sso_id == user_info["sso_id"])).first()
    if not user:
        # Fallback to email if OID doesn't match yet
        user = session.exec(select(User).where(User.email == user_info["email"])).first()
        if not user:
            # Create new user via SSO
            user = User(
                email=user_info["email"],
                username=user_info["email"],
                role=settings.default_sso_role or UserRole.READ_ONLY,
                is_active=True
            )
            session.add(user)
    
    # Always ensure SSO info is updated
    user.sso_id = user_info["sso_id"]
    user.sso_provider = "entra"
    user.auth_source = AuthSource.ENTRA_ID
    
    user.last_login = datetime.utcnow()
    user.last_login_ip = client_ip
    user.last_login_method = "entra"
    
    session.add(user)
    session.flush() # Ensure user.id is populated for log_audit
    
    log_audit(session, user.id, client_ip, "entra", "success")
    session.commit()
    session.refresh(user)
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    # Redirect back to frontend with token
    frontend_url = settings.public_url or os.getenv("FRONTEND_URL", "http://localhost:13060")
    return RedirectResponse(f"{frontend_url.rstrip('/')}/?token={access_token}&role={user.role}")

@app.get("/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "auth_source": user.auth_source,
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

def refresh_domain_dns(domain_name):
    dns_utils.get_spf_record(domain_name)
    dns_utils.get_dmarc_record(domain_name)
    dns_utils.get_dkim_status_heuristic(domain_name)

@app.get("/domains")
def get_domains(
    background_tasks: BackgroundTasks,
    start_date: str = None,
    end_date: str = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    domains = session.exec(select(Domain)).all()
    results = []
    for d in domains:
        spf = dns_utils.r_cache.get(f"dns:spf:{d.name}")
        dkim = dns_utils.r_cache.get(f"dns:dkim:{d.name}")
        dmarc = dns_utils.r_cache.get(f"dns:dmarc:{d.name}")
        
        if not spf or not dkim or not dmarc:
            background_tasks.add_task(refresh_domain_dns, d.name)
            
        # Failure stats (filtered or last 30 days)
        if start_date:
            start_dt = datetime.fromisoformat(start_date)
        else:
            start_dt = datetime.utcnow() - timedelta(days=30)
            
        if end_date:
            end_dt = normalize_end_date(end_date)
        else:
            end_dt = datetime.utcnow()

        spf_fails = session.exec(select(func.sum(ReportRecord.count)).join(ReportMetadata).where(
            ReportMetadata.domain_name == d.name, 
            ReportRecord.spf_pass == False,
            ReportMetadata.date_end >= start_dt,
            ReportMetadata.date_end <= end_dt
        )).one() or 0
        dkim_fails = session.exec(select(func.sum(ReportRecord.count)).join(ReportMetadata).where(
            ReportMetadata.domain_name == d.name, 
            ReportRecord.dkim_pass == False,
            ReportMetadata.date_end >= start_dt,
            ReportMetadata.date_end <= end_dt
        )).one() or 0
            
        dmarc_data = json.loads(dmarc) if dmarc else None
        live_policy = dmarc_data.get("policy") if dmarc_data and "policy" in dmarc_data else d.dmarc_policy

        if dmarc_data and dmarc_data.get("policy") and d.dmarc_policy != dmarc_data.get("policy"):
            d.dmarc_policy = dmarc_data.get("policy")
            session.add(d)
            session.commit()
            session.refresh(d)
            
        results.append({
            "id": d.id,
            "name": d.name,
            "dmarc_policy": live_policy or "none",
            "spf_fail_count": spf_fails,
            "dkim_fail_count": dkim_fails,
            "dns_summary": {
                "spf": json.loads(spf)["status"] if spf else "Loading...",
                "dkim": json.loads(dkim)["status"] if dkim else "Loading...",
                "dmarc": dmarc_data["status"] if dmarc_data else "Loading..."
            }
        })
    return results

@app.post("/domains/refresh-dns")
def refresh_all_dns(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN, UserRole.ANALYST]))
) -> dict:
    max_domains = 50
    total_domains = session.exec(select(func.count(Domain.id))).one()
    domains_to_process = session.exec(select(Domain).limit(max_domains)).all()
    failed_domains = []
    
    for d in domains_to_process:
        try:
            dns_utils.r_cache.delete(f"dns:spf:{d.name}")
            dns_utils.r_cache.delete(f"dns:dkim:{d.name}")
            dns_utils.r_cache.delete(f"dns:dmarc:{d.name}")
            # Invalidate learned DKIM selector keys
            learned_keys = dns_utils.r_cache.keys(f"dns:dkim:{d.name}:learned:*")
            if learned_keys:
                dns_utils.r_cache.delete(*learned_keys)
            refresh_domain_dns(d.name)
            dmarc_data = dns_utils.get_dmarc_record(d.name)
            if dmarc_data and dmarc_data.get("policy"):
                d.dmarc_policy = dmarc_data.get("policy")
                session.add(d)
        except Exception as e:
            traceback.print_exc()
            failed_domains.append({"domain": d.name, "error": str(e)})

    session.commit()
    log_system_event(
        session,
        component="backend",
        level="WARNING" if failed_domains else "INFO",
        event_type="dns_refresh",
        message=f"DNS cache refreshed for {len(domains_to_process)} domain(s) (Failures: {len(failed_domains)}).",
        details=json.dumps({"processed": len(domains_to_process), "failures": failed_domains})
    )
    res = {"status": "refreshed", "processed": len(domains_to_process), "total": total_domains}
    if failed_domains:
        res["failures"] = failed_domains
    return res

@app.get("/domains/{domain_id}/dns")
def get_domain_dns_details(
    domain_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    domain = session.get(Domain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    
    # Query learned DKIM selectors from DMARC reports stored in DB
    db_records = session.exec(
        select(ReportRecord.dkim_auth_results)
        .join(ReportMetadata)
        .where(func.lower(ReportMetadata.domain_name) == domain.name.lower())
    ).all()

    learned_selectors = set()
    for res_json in db_records:
        if res_json:
            try:
                details = json.loads(res_json)
                if isinstance(details, list):
                    for item in details:
                        if isinstance(item, dict):
                            sel = item.get("selector")
                            if sel:
                                learned_selectors.add(sel)
            except (json.JSONDecodeError, TypeError, AttributeError):
                traceback.print_exc()

    dmarc_res = dns_utils.get_dmarc_record(domain.name)
    if dmarc_res and dmarc_res.get("policy") and domain.dmarc_policy != dmarc_res.get("policy"):
        domain.dmarc_policy = dmarc_res.get("policy")
        session.add(domain)
        session.commit()
        session.refresh(domain)

    return {
        "spf": dns_utils.get_spf_record(domain.name),
        "dmarc": dmarc_res,
        "dkim": dns_utils.get_dkim_status_heuristic(domain.name, db_selectors=list(learned_selectors))
    }

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
    start_date: str = None,
    end_date: str = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    # Case-insensitive join and filter
    statement = (
        select(ReportRecord)
        .join(ReportMetadata)
        .where(func.lower(ReportMetadata.domain_name) == domain_name.lower())
        .where(ReportMetadata.is_test == False)
    )
    
    if start_date:
        statement = statement.where(ReportMetadata.date_end >= datetime.fromisoformat(start_date))
    if end_date:
        statement = statement.where(ReportMetadata.date_end <= normalize_end_date(end_date))
        
    statement = statement.order_by(ReportMetadata.date_end.desc())
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

@app.get("/reports/records")
def get_all_records(
    start_date: str = None,
    end_date: str = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    statement = (
        select(ReportRecord)
        .join(ReportMetadata)
        .where(ReportMetadata.is_test == False)
    )
    
    if start_date:
        statement = statement.where(ReportMetadata.date_end >= datetime.fromisoformat(start_date))
    if end_date:
        statement = statement.where(ReportMetadata.date_end <= normalize_end_date(end_date))
        
    statement = statement.order_by(ReportMetadata.date_end.desc()).limit(2000)
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
            "domain_name": r.report.domain_name,
            "date": r.report.date_end.isoformat()
        }
        for r in results
    ]

@app.get("/ips/{ip_address}")
def get_ip_details(
    ip_address: str,
    user: User = Depends(get_current_user)
):
    enrichment = ip_utils.get_ip_enrichment(ip_address)
    return enrichment

@app.get("/reports/stats")
def get_report_stats(
    start_date: str = None,
    end_date: str = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    statement = select(ReportRecord).join(ReportMetadata).where(ReportMetadata.is_test == False)
    
    if start_date:
        statement = statement.where(ReportMetadata.date_end >= datetime.fromisoformat(start_date))
    else:
        # Default to last 30 days
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        statement = statement.where(ReportMetadata.date_end >= thirty_days_ago)
        
    if end_date:
        statement = statement.where(ReportMetadata.date_end <= normalize_end_date(end_date))
        
    records = session.exec(statement).all()
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
            org_name = metadata.findtext("org_name")
            date_begin = datetime.fromtimestamp(int(metadata.find("date_range").findtext("begin"))).isoformat() if metadata.find("date_range") and metadata.find("date_range").findtext("begin") else None
            date_end = datetime.fromtimestamp(int(metadata.find("date_range").findtext("end"))).isoformat() if metadata.find("date_range") and metadata.find("date_range").findtext("end") else None
            domain_name = root.find("policy_published").findtext("domain") if root.find("policy_published") is not None else "unknown"

            source_ips = []
            for record in root.findall("record"):
                row = record.find("row")
                if row is not None:
                    ip = row.findtext("source_ip")
                    cnt = int(row.findtext("count") or 1)
                    if ip:
                        source_ips.append({"ip": ip, "count": cnt})

            report_details = {
                "org_name": org_name,
                "report_id": report_id,
                "domain_name": domain_name,
                "date_begin": date_begin,
                "date_end": date_end,
                "source_ips": source_ips
            }

            existing = session.exec(select(ReportMetadata).where(ReportMetadata.report_id == report_id)).first()
            if existing:
                report_details["existing_in_db"] = True
                results.append({"filename": file.filename, "status": "skipped", "report_details": report_details})
                continue
                
            report = ReportMetadata(
                org_name=org_name,
                email=metadata.findtext("email"),
                report_id=report_id,
                date_begin=datetime.fromisoformat(date_begin) if date_begin else datetime.utcnow(),
                date_end=datetime.fromisoformat(date_end) if date_end else datetime.utcnow(),
                domain_name=domain_name or "unknown"
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

                target_org = dns_utils.get_org_domain(report.domain_name)

                dkim_pass = any(
                    d["result"] == "pass" and dns_utils.get_org_domain(d.get("domain")) == target_org
                    for d in dkim_res_list
                )
                spf_pass = any(
                    s["result"] == "pass" and 
                    (s.get("scope") == "mfrom" or s.get("scope") is None) and 
                    dns_utils.get_org_domain(s.get("domain")) == target_org
                    for s in spf_res_list
                )
                        
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

# --- SMTP Testing Endpoints ---

SAMPLE_RUA_XML = """<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>TEST-SENDER</org_name>
    <email>noreply@test.com</email>
    <report_id>TEST-{id}</report_id>
    <date_range>
      <begin>{begin}</begin>
      <end>{end}</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>{domain}</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>quarantine</p>
    <sp>quarantine</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>1.2.3.4</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>{domain}</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>{domain}</domain>
        <result>pass</result>
        <selector>default</selector>
      </dkim>
      <spf>
        <domain>{domain}</domain>
        <scope>mfrom</scope>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
</feedback>
"""

@app.post("/admin/smtp/test-trigger")
def trigger_smtp_test(
    domain: str,
    recipient: str,
    type: str = "RUA",
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    settings = session.exec(select(SystemSettings)).first()
    if not settings.smtp_test_mode_enabled:
        raise HTTPException(status_code=403, detail="SMTP Test Mode is disabled in Global Settings")
    
    # Validation
    allowed = (settings.allowed_test_recipients or "").split(",")
    if recipient not in [a.strip() for a in allowed if a.strip()]:
        raise HTTPException(status_code=400, detail=f"Recipient {recipient} is not in the allowed test list")

    try:
        msg = EmailMessage()
        msg['Subject'] = f"Report Domain: {domain} Submit Date: {datetime.now().strftime('%Y-%m-%d')}"
        msg['From'] = "dmarc-test@internal.system"
        msg['To'] = recipient
        msg['X-DMARC-Test'] = "true"
        
        xml_content = SAMPLE_RUA_XML.format(
            id=str(uuid.uuid4())[:8],
            begin=int(datetime.now().timestamp()) - 86400,
            end=int(datetime.now().timestamp()),
            domain=domain
        )
        
        msg.add_attachment(
            xml_content.encode('utf-8'),
            maintype='application',
            subtype='xml',
            filename=f"google.com!{domain}!1234!5678.xml"
        )
        
        # Connect to local ingester
        with smtplib.SMTP("smtp-ingester", 2525) as server:
            server.send_message(msg)
            
        return {"status": "success", "detail": "Test message sent to SMTP ingester"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@app.get("/admin/smtp/test-results")
def get_test_results(
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN]))
):
    results = session.exec(select(ReportMetadata).where(ReportMetadata.is_test == True).order_by(ReportMetadata.date_end.desc()).limit(20)).all()
    return results

@app.get("/admin/smtp/scripts/{script_type}")
def get_configured_test_script(
    script_type: str,
    domain: str = None,
    recipient: str = None,
    session: Session = Depends(get_session),
    user: User = Depends(RoleChecker([UserRole.ADMIN, UserRole.ANALYST]))
):
    import os
    
    settings = session.exec(select(SystemSettings)).first()
    
    # Fallback to defaults if not provided
    if not domain:
        # Get first managed domain
        first_domain = session.exec(select(Domain)).first()
        domain = first_domain.name if first_domain else "example.com"
        
    if not recipient:
        allowed = (settings.allowed_test_recipients or "").split(",")
        recipient = allowed[0].strip() if allowed and allowed[0].strip() else f"report@dmarc.{domain}"

    # Construct the path to the script template
    ext_map = {"python": "py", "powershell": "ps1", "bash": "sh"}
    ext = ext_map.get(script_type.lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Invalid script type. Use 'python', 'powershell', or 'bash'")
        
    script_path = f"/app/scripts/smtp_tests/test_dmarc.{ext}"
    if not os.path.exists(script_path):
        # Local dev path fallback
        script_path = f"scripts/smtp_tests/test_dmarc.{ext}"
        
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        from urllib.parse import urlparse
        parsed_url = urlparse(os.getenv("FRONTEND_URL", "http://localhost"))
        frontend_host = parsed_url.hostname or "localhost"
        
        # Dynamically inject defaults into the script
        if script_type.lower() == "powershell":
            content = content.replace('$HostName = "localhost"', f'$HostName = "{frontend_host}"')
            content = content.replace('[Parameter(Mandatory=$true)][string]$Domain', f'[Parameter(Mandatory=$false)][string]$Domain = "{domain}"')
            content = content.replace('[Parameter(Mandatory=$true)][string]$Recipient', f'[Parameter(Mandatory=$false)][string]$Recipient = "{recipient}"')
        elif script_type.lower() == "python":
            content = content.replace('default="localhost"', f'default="{frontend_host}"')
            content = content.replace('required=True, help="Domain to report for"', f'default="{domain}", help="Domain to report for"')
            content = content.replace('required=True, help="Recipient address"', f'default="{recipient}", help="Recipient address"')
        elif script_type.lower() == "bash":
            content = content.replace('HOST=${1:-"localhost"}', f'HOST=${{1:-"{frontend_host}"}}')
            content = content.replace('DOMAIN=${3:-"test-domain.com"}', f'DOMAIN=${{3:-"{domain}"}}')
            content = content.replace('RECIPIENT=${4:-"report@dmarc.domain.com"}', f'RECIPIENT=${{4:-"{recipient}"}}')
        
        from fastapi.responses import Response
        return Response(content=content, media_type="text/plain", headers={
            "Content-Disposition": f"attachment; filename=test_dmarc.{ext}"
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to load script template: {str(e)}")

