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
from models import ReportMetadata, ReportRecord, SQLModel, SystemProcessingLog

DB_DSN = os.getenv("DB_DSN", "postgresql+psycopg://dmarc_admin:secure_dmarc_pass@postgres:5432/dmarc_monitor")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
RAW_PATH = os.getenv("RAW_PATH", "/data/raw")

engine = create_engine(DB_DSN)

def log_system_event(session, component: str, level: str, event_type: str, message: str, details: str | None = None, is_test: bool = False, timestamp: datetime | None = None):
    try:
        log_entry = SystemProcessingLog(
            timestamp=timestamp or datetime.utcnow(),
            component=component,
            level=level,
            event_type=event_type,
            message=message,
            details=details,
            is_test=is_test
        )
        session.add(log_entry)
        session.commit()
    except Exception as e:
        print(f"Failed to record system log entry: {e}")

def drain_system_log_queue(r, session):
    try:
        while True:
            item = r.rpop("system_log_jobs")
            if not item:
                break
            payload = json.loads(item)
            ts = None
            if "timestamp" in payload and payload["timestamp"]:
                try:
                    ts = datetime.fromisoformat(payload["timestamp"])
                except Exception:
                    pass
            log_system_event(
                session,
                component=payload.get("component", "system"),
                level=payload.get("level", "INFO"),
                event_type=payload.get("event_type", "general"),
                message=payload.get("message", ""),
                details=payload.get("details"),
                is_test=payload.get("is_test", False),
                timestamp=ts
            )
    except Exception as e:
        print(f"Error draining system_log_jobs: {e}")

def parse_and_store(xml_data, is_test):
    with Session(engine) as session:
        try:
            root = ET.fromstring(xml_data)
        except Exception as e:
            err_msg = f"XML parsing failed: {e}"
            print(err_msg)
            log_system_event(session, component="dmarc-parser", level="ERROR", event_type="parse_error", message=err_msg, is_test=is_test)
            return

        metadata = root.find("report_metadata")
        if metadata is None:
            log_system_event(session, component="dmarc-parser", level="WARNING", event_type="parse_error", message="Missing report_metadata element in XML payload", is_test=is_test)
            return
            
        report_id = metadata.findtext("report_id")
        existing = session.exec(select(ReportMetadata).where(ReportMetadata.report_id == report_id)).first()
        if existing:
            print(f"Report {report_id} already exists. Skipping.")
            log_system_event(session, component="dmarc-parser", level="INFO", event_type="report_skipped", message=f"Report {report_id} already exists in database. Skipped duplicate.", is_test=is_test)
            return
            
        try:
            report = ReportMetadata(
                org_name=metadata.findtext("org_name") or "unknown",
                email=metadata.findtext("email") or "",
                report_id=report_id,
                date_begin=datetime.fromtimestamp(int(metadata.find("date_range").findtext("begin"))),
                date_end=datetime.fromtimestamp(int(metadata.find("date_range").findtext("end"))),
                domain_name=root.find("policy_published").findtext("domain") or "unknown",
                is_test=is_test
            )
            session.add(report)
            session.flush()
        except Exception as e:
            err_msg = f"Failed to construct ReportMetadata: {e}"
            print(err_msg)
            log_system_event(session, component="dmarc-parser", level="ERROR", event_type="parse_error", message=err_msg, is_test=is_test)
            return
        
        record_count = 0
        for record in root.findall("record"):
            row = record.find("row")
            source_ip = row.findtext("source_ip")
            count = int(row.findtext("count"))
            disposition = row.find("policy_evaluated").findtext("disposition")
            
            auth_results = record.find("auth_results")
            
            dkim_res_list = []
            if auth_results is not None:
                for d in auth_results.findall("dkim"):
                    dkim_res_list.append({
                        "domain": d.findtext("domain"),
                        "selector": d.findtext("selector"),
                        "result": d.findtext("result"),
                        "human_result": d.findtext("human_result")
                    })
                
            spf_res_list = []
            if auth_results is not None:
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
                two_level_tlds = {
                    "co.uk", "org.uk", "gov.uk", "me.uk",
                    "com.au", "net.au", "org.au",
                    "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
                    "co.jp", "or.jp", "co.nz"
                }
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
                    
            r_rec = ReportRecord(
                report_id=report.id,
                source_ip=source_ip,
                count=count,
                disposition=disposition,
                dkim_pass=dkim_pass,
                spf_pass=spf_pass,
                dkim_auth_results=json.dumps(dkim_res_list),
                spf_auth_results=json.dumps(spf_res_list)
            )
            session.add(r_rec)
            record_count += 1
        
        session.commit()
        print(f"Stored report {report_id} with {record_count} records (Test: {is_test})")
        log_system_event(
            session,
            component="dmarc-parser",
            level="INFO",
            event_type="report_parsed",
            message=f"Parsed DMARC report from {report.org_name} for domain {report.domain_name} ({record_count} record rows).",
            details=json.dumps({"report_id": report_id, "org_name": report.org_name, "domain_name": report.domain_name, "records_count": record_count}),
            is_test=is_test
        )

def main():
    print(f"DMARC Parser Worker started. Connecting to Redis: {REDIS_URL}")
    r = redis.from_url(REDIS_URL)
    
    while True:
        try:
            with Session(engine) as session:
                drain_system_log_queue(r, session)

            # Block up to 2 seconds for a dmarc job
            res = r.brpop("dmarc_jobs", timeout=2)
            if not res:
                continue
            _, job_json = res
            job = json.loads(job_json)
            
            filename = job["filename"]
            is_test = job.get("is_test", False)
            file_path = os.path.join(RAW_PATH, filename)
            
            if not os.path.exists(file_path):
                print(f"File not found: {file_path}")
                with Session(engine) as session:
                    log_system_event(session, component="dmarc-parser", level="ERROR", event_type="file_not_found", message=f"Payload file not found on disk: {filename}", is_test=is_test)
                continue
                
            with open(file_path, "rb") as f:
                content = f.read()
                
            if filename.endswith('.gz') or filename.endswith('.gz.test'):
                xml_data = gzip.decompress(content)
            elif filename.endswith('.zip') or filename.endswith('.zip.test'):
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    xml_files = [n for n in z.namelist() if n.endswith('.xml')]
                    if not xml_files:
                        with Session(engine) as session:
                            log_system_event(session, component="dmarc-parser", level="WARNING", event_type="parse_error", message=f"No XML found in zip archive: {filename}", is_test=is_test)
                        continue
                    xml_data = z.read(xml_files[0])
            else:
                xml_data = content
                
            parse_and_store(xml_data, is_test)
            
        except Exception as e:
            print(f"Error processing job: {e}")
            try:
                with Session(engine) as session:
                    log_system_event(session, component="dmarc-parser", level="ERROR", event_type="parse_error", message=f"Exception in parser worker loop: {e}")
            except Exception:
                pass
            time.sleep(1)

if __name__ == "__main__":
    main()

