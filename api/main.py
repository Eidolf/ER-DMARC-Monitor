import os
import gzip
import zipfile
import io
import traceback
import sys
import json
from datetime import datetime
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlmodel import Session, create_engine, SQLModel, select, func
from pydantic import BaseModel
from defusedxml import ElementTree as ET

from models import Domain, ReportMetadata, ReportRecord

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
            break
        except Exception:
            time.sleep(2)

def get_session():
    with Session(engine) as session:
        yield session

class DomainCreate(BaseModel):
    name: str
    dmarc_policy: str = "none"

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/domains")
def create_domain(domain: DomainCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Domain).where(Domain.name == domain.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists")
    db_domain = Domain(name=domain.name, dmarc_policy=domain.dmarc_policy)
    session.add(db_domain)
    session.commit()
    session.refresh(db_domain)
    return db_domain

@app.get("/domains")
def get_domains(session: Session = Depends(get_session)):
    return session.exec(select(Domain)).all()

@app.delete("/domains/{domain_id}")
def delete_domain(domain_id: int, session: Session = Depends(get_session)):
    domain = session.get(Domain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    session.delete(domain)
    session.commit()
    return {"status": "success"}

@app.get("/domains/{domain_name}/records")
def get_domain_records(domain_name: str, session: Session = Depends(get_session)):
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
def get_report_stats(session: Session = Depends(get_session)):
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
async def upload_reports(files: list[UploadFile] = File(...), session: Session = Depends(get_session)):
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
