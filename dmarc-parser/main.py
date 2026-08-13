import os
import time
import json
import redis
import gzip
import zipfile
import io
from datetime import datetime
from sqlmodel import Session, create_engine, select
from defusedxml import ElementTree as ET
from models import ReportMetadata, ReportRecord, SQLModel

DB_DSN = os.getenv("DB_DSN", "postgresql+psycopg://dmarc_admin:secure_dmarc_pass@postgres:5432/dmarc_monitor")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
RAW_PATH = os.getenv("RAW_PATH", "/data/raw")

engine = create_engine(DB_DSN)

def parse_and_store(xml_data, is_test):
    with Session(engine) as session:
        root = ET.fromstring(xml_data)
        metadata = root.find("report_metadata")
        if metadata is None: return
            
        report_id = metadata.findtext("report_id")
        existing = session.exec(select(ReportMetadata).where(ReportMetadata.report_id == report_id)).first()
        if existing:
            print(f"Report {report_id} already exists. Skipping.")
            return
            
        report = ReportMetadata(
            org_name=metadata.findtext("org_name"),
            email=metadata.findtext("email"),
            report_id=report_id,
            date_begin=datetime.fromtimestamp(int(metadata.find("date_range").findtext("begin"))),
            date_end=datetime.fromtimestamp(int(metadata.find("date_range").findtext("end"))),
            domain_name=root.find("policy_published").findtext("domain") or "unknown",
            is_test=is_test
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

            def get_org_domain(dom: str | None) -> str:
                if not dom:
                    return ""
                d = dom.lower().strip(".")
                parts = d.split(".")
                if len(parts) <= 2:
                    return d
                two_level_tlds = {"co.uk", "org.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.jp", "or.jp", "co.nz"}
                if f"{parts[-2]}.{parts[-1]}" in two_level_tlds and len(parts) >= 3:
                    return f"{parts[-3]}.{parts[-2]}.{parts[-1]}"
                return f"{parts[-2]}.{parts[-1]}"

            target_org = get_org_domain(report.domain_name)

            dkim_pass = any(
                d["result"] == "pass" and get_org_domain(d.get("domain")) == target_org
                for d in dkim_res_list
            )
            spf_pass = any(
                s["result"] == "pass" and 
                (s.get("scope") == "mfrom" or s.get("scope") is None) and 
                get_org_domain(s.get("domain")) == target_org
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
        
        session.commit()
        print(f"Stored report {report_id} (Test: {is_test})")

def main():
    print(f"DMARC Parser Worker started. Connecting to Redis: {REDIS_URL}")
    r = redis.from_url(REDIS_URL)
    
    while True:
        try:
            # Block until a job is available
            res = r.brpop("dmarc_jobs")
            if not res: continue
            _, job_json = res
            job = json.loads(job_json)
            
            filename = job["filename"]
            is_test = job.get("is_test", False)
            file_path = os.path.join(RAW_PATH, filename)
            
            if not os.path.exists(file_path):
                print(f"File not found: {file_path}")
                continue
                
            with open(file_path, "rb") as f:
                content = f.read()
                
            if filename.endswith('.gz') or filename.endswith('.gz.test'):
                xml_data = gzip.decompress(content)
            elif filename.endswith('.zip') or filename.endswith('.zip.test'):
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    xml_files = [n for n in z.namelist() if n.endswith('.xml')]
                    if not xml_files: continue
                    xml_data = z.read(xml_files[0])
            else:
                xml_data = content
                
            parse_and_store(xml_data, is_test)
            
        except Exception as e:
            print(f"Error processing job: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
