import os
import sys
import traceback
import asyncio
import uuid
import json
import redis
from datetime import datetime
from email import message_from_bytes
from aiosmtpd.controller import Controller
from aiosmtpd.handlers import AsyncMessage

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
RAW_PATH = os.getenv("RAW_PATH", "/data/raw")

def push_system_log(
    r: redis.Redis,
    level: str,
    event_type: str,
    message: str,
    details: str | None = None,
    is_test: bool = False
) -> None:
    try:
        log_payload = {
            "component": "smtp-ingester",
            "level": level,
            "event_type": event_type,
            "message": message,
            "details": details,
            "is_test": is_test,
            "timestamp": datetime.utcnow().isoformat()
        }
        r.lpush("system_log_jobs", json.dumps(log_payload))
    except Exception:
        traceback.print_exc(file=sys.stderr)


class DMARCReceivingHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        # Strip angle brackets if present (e.g. <user@domain.com>)
        address = address.strip()
        if address.startswith('<') and address.endswith('>'):
            address = address[1:-1]

        try:
            if '@' not in address:
                return '501 Bad recipient address syntax'
            local_part, domain = address.lower().split('@')
        except ValueError:
            return '501 Bad recipient address syntax'

        try:
            r = redis.from_url(REDIS_URL)
            
            # Check if domain is allowed
            if not r.sismember("smtp:allowed:domains", domain):
                print(f"Rejected RCPT: Domain {domain} not in allowed list")
                push_system_log(r, level="WARNING", event_type="mail_rejected", message=f"Rejected RCPT to <{address}>: Domain {domain} not configured.", details=json.dumps({"domain": domain, "local_part": local_part, "reason": "domain_not_allowed"}))
                return '550 Relay not permitted'
                
            # Check if recipient is allowed for this domain
            if not r.sismember(f"smtp:allowed:recipients:{domain}", local_part):
                print(f"Rejected RCPT: Recipient {local_part} not in allowed list for {domain}")
                push_system_log(r, level="WARNING", event_type="mail_rejected", message=f"Rejected RCPT to <{address}>: Recipient not configured for domain {domain}.", details=json.dumps({"domain": domain, "local_part": local_part, "reason": "recipient_not_allowed"}))
                return '550 No such user here'
        except Exception as e:
            print(f"Redis lookup error: {e}")
            return '451 Temporary local error'

        envelope.rcpt_tos.append(address)
        return '250 OK'

    async def handle_DATA(self, server, session, envelope):
        message = message_from_bytes(envelope.content)
        is_test = message.get("X-DMARC-Test", "").lower() == "true"
        
        print(f"Received message. From: {envelope.mail_from}, To: {envelope.rcpt_tos}, Test: {is_test}")
        
        # Ensure raw path exists
        os.makedirs(RAW_PATH, exist_ok=True)
        
        payloads_found = 0
        jobs_to_queue = []
        for part in message.walk():
            if part.get_content_maintype() == 'multipart':
                continue
            
            filename = part.get_filename()
            if not filename:
                continue
                
            payload = part.get_payload(decode=True)
            if not payload:
                continue
                
            payloads_found += 1

            # Generate unique ID for this payload
            job_id = str(uuid.uuid4())
            storage_name = f"{job_id}_{filename}"
            if is_test:
                storage_name += ".test"
                
            with open(os.path.join(RAW_PATH, storage_name), "wb") as f:
                f.write(payload)
            
            jobs_to_queue.append({
                "job_id": job_id,
                "filename": storage_name,
                "is_test": is_test,
                "received_at": str(asyncio.get_event_loop().time()),
                "recipient": envelope.rcpt_tos[0] if envelope.rcpt_tos else "unknown"
            })

        if jobs_to_queue:
            try:
                pipe = r.pipeline()
                for job_data in jobs_to_queue:
                    pipe.lpush("dmarc_jobs", json.dumps(job_data))
                pipe.execute()
                payloads_queued = len(jobs_to_queue)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                push_system_log(
                    r,
                    level="ERROR",
                    event_type="mail_enqueue_failed",
                    message=f"Failed to queue {len(jobs_to_queue)} payload(s) from {envelope.mail_from}.",
                    details=json.dumps({"from": envelope.mail_from, "recipients": envelope.rcpt_tos, "payloads_found": payloads_found, "payloads_queued": 0}),
                    is_test=is_test
                )
                return '451 Temporary queue error, please retry later'

        push_system_log(
            r,
            level="INFO",
            event_type="mail_received",
            message=f"Received email from {envelope.mail_from} with {payloads_found} payload attachment(s) ({payloads_queued} queued).",
            details=json.dumps({"from": envelope.mail_from, "recipients": envelope.rcpt_tos, "payloads_found": payloads_found, "payloads_queued": payloads_queued}),
            is_test=is_test
        )
        return '250 Message accepted for delivery'




async def amain():
    host = os.getenv("SMTP_HOST", "0.0.0.0")
    port = int(os.getenv("SMTP_PORT", 2525))
    
    handler = DMARCReceivingHandler()
    controller = Controller(handler, hostname=host, port=port)
    
    print(f"Starting DMARC SMTP Ingester on {host}:{port}...")
    print(f"Storing payloads in: {RAW_PATH}")
    controller.start()
    
    while True:
        await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(amain())
