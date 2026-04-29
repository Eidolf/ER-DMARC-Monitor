import os
import asyncio
import uuid
import json
import redis
from email import message_from_bytes
from aiosmtpd.controller import Controller
from aiosmtpd.handlers import AsyncMessage

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
RAW_PATH = os.getenv("RAW_PATH", "/data/raw")

class DMARCReceivingHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
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
                return '550 Relay not permitted'
                
            # Check if recipient is allowed for this domain
            if not r.sismember(f"smtp:allowed:recipients:{domain}", local_part):
                print(f"Rejected RCPT: Recipient {local_part} not in allowed list for {domain}")
                return '550 No such user here'
        except Exception as e:
            print(f"Redis lookup error: {e}")
            # Fail closed or open? Requirement says "SMTP messages to non-configured recipients must be rejected"
            # But if Redis is down, we might want to log and temporarily reject
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
        for part in message.walk():
            if part.get_content_maintype() == 'multipart':
                continue
            
            filename = part.get_filename()
            if not filename:
                continue
                
            payload = part.get_payload(decode=True)
            if not payload:
                continue
                
            # Generate unique ID for this payload
            job_id = str(uuid.uuid4())
            storage_name = f"{job_id}_{filename}"
            if is_test:
                storage_name += ".test"
                
            with open(os.path.join(RAW_PATH, storage_name), "wb") as f:
                f.write(payload)
            
            # Push to Redis queue for the parser
            try:
                r = redis.from_url(REDIS_URL)
                job_data = {
                    "job_id": job_id,
                    "filename": storage_name,
                    "is_test": is_test,
                    "received_at": str(asyncio.get_event_loop().time()),
                    "recipient": envelope.rcpt_tos[0] if envelope.rcpt_tos else "unknown"
                }
                r.lpush("dmarc_jobs", json.dumps(job_data))
                payloads_found += 1
            except Exception as e:
                print(f"Failed to push to Redis: {e}")

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
