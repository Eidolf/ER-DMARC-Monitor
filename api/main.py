import os
import gzip
import zipfile
import io
from datetime import datetime
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from sqlmodel import Session, create_engine, SQLModel, select
from pydantic import BaseModel
from defusedxml import ElementTree as ET

from models import Domain, ReportMetadata, ReportRecord

DB_DSN = os.getenv("DB_DSN", "sqlite:///database.db")
engine = create_engine(DB_DSN)

app = FastAPI(title="DMARC Monitoring API")

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

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
async def upload_report(file: UploadFile = File(...), session: Session = Depends(get_session)):
    content = await file.read()
    
    try:
        if file.filename.endswith('.gz'):
            xml_data = gzip.decompress(content)
        elif file.filename.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                first_file = [n for n in z.namelist() if n.endswith('.xml')][0]
                xml_data = z.read(first_file)
        else:
            xml_data = content
            
        root = ET.fromstring(xml_data)
        metadata = root.find("report_metadata")
        if metadata is None:
            raise ValueError("report_metadata missing - not a valid DMARC aggregate report")
            
        report_id = metadata.findtext("report_id")
        
        # Idempotency block
        existing = session.exec(select(ReportMetadata).where(ReportMetadata.report_id == report_id)).first()
        if existing:
            return {"status": "skipped", "message": "Report already exists"}
            
        report = ReportMetadata(
            org_name=metadata.findtext("org_name"),
            email=metadata.findtext("email"),
            report_id=report_id,
            date_begin=datetime.fromtimestamp(int(metadata.find("date_range").findtext("begin"))),
            date_end=datetime.fromtimestamp(int(metadata.find("date_range").findtext("end")))
        )
        session.add(report)
        session.flush() # fetch generated ID
        
        for record in root.findall("record"):
            row = record.find("row")
            source_ip = row.findtext("source_ip")
            count = int(row.findtext("count"))
            disposition = row.find("policy_evaluated").findtext("disposition")
            
            auth_results = record.find("auth_results")
            dkim_pass = False
            spf_pass = False
            
            dkim_nodes = auth_results.findall("dkim")
            if dkim_nodes:
                dkim_pass = any(node.findtext("result") == "pass" for node in dkim_nodes)
                
            spf_nodes = auth_results.findall("spf")
            if spf_nodes:
                spf_pass = any(node.findtext("result") == "pass" for node in spf_nodes)
                    
            r = ReportRecord(
                report_id=report.id,
                source_ip=source_ip,
                count=count,
                disposition=disposition,
                dkim_pass=dkim_pass,
                spf_pass=spf_pass
            )
            session.add(r)
            
        session.commit()
        return {"status": "success", "report_id": report_id}
        
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=f"Error parsing report: {str(e)}")
