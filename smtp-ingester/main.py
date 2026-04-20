import os
import asyncio
from aiosmtpd.controller import Controller
from aiosmtpd.handlers import AsyncMessage

class DMARCReceivingHandler(AsyncMessage):
    async def handle_message(self, message):
        """
        Called when a message successfully arrives.
        Parses headers and extracts payload (XML/ZIP/GZ).
        """
        print(f"Received message from: {message['From']}")
        print(f"Subject: {message['Subject']}")
        
        # Here we would:
        # 1. Ensure Recipient is authorized (e.g. report.domain.com)
        # 2. Iterate through message.walk() to find attachments.
        # 3. Save raw payload to volume.
        # 4. Push event to Redis queue for the parser component.
        
        # Return standard SMTP 250 OK
        return '250 Message accepted for delivery'

async def amain():
    host = os.getenv("SMTP_HOST", "0.0.0.0")
    port = int(os.getenv("SMTP_PORT", 2525))
    
    handler = DMARCReceivingHandler()
    controller = Controller(handler, hostname=host, port=port)
    
    print(f"Starting DMARC SMTP Ingester on {host}:{port}...")
    controller.start()
    
    # Keep the event loop running
    while True:
        await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(amain())
