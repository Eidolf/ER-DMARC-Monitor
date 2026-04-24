#!/usr/bin/env python3
# Usage: python3 test_dmarc.py --domain example.com --to report@dmarc.domain.com
import smtplib
import uuid
import argparse
from email.message import EmailMessage
from datetime import datetime

# Canonical DMARC RUA Example
RUA_TEMPLATE = """<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>EXTERNAL-SMTP-TEST-TOOL</org_name>
    <email>noreply@test-script.org</email>
    <report_id>SCRIPT-{id}</report_id>
    <date_range>
      <begin>{begin}</begin>
      <end>{end}</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>{domain}</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>none</p>
    <sp>none</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>127.0.0.1</source_ip>
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

def send_test_report(host, port, domain, recipient, is_test=True):
    print(f"Connecting to {host}:{port}...")
    try:
        msg = EmailMessage()
        msg['Subject'] = f"Report Domain: {domain} Submit Date: {datetime.now().strftime('%Y-%m-%d')}"
        msg['From'] = "test-script@external.tool"
        msg['To'] = recipient
        
        if is_test:
            msg['X-DMARC-Test'] = "true"
            print("Flagging message as TEST DATA (X-DMARC-Test: true)")

        xml_content = RUA_TEMPLATE.format(
            id=str(uuid.uuid4())[:8],
            begin=int(datetime.now().timestamp()) - 86400,
            end=int(datetime.now().timestamp()),
            domain=domain
        )
        
        msg.add_attachment(
            xml_content.encode('utf-8'),
            maintype='application',
            subtype='xml',
            filename=f"script-test!{domain}!rua.xml"
        )
        
        with smtplib.SMTP(host, port) as server:
            # server.starttls() # Uncomment if STARTTLS is required
            server.send_message(msg)
            
        print("Successfully sent DMARC test report.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send a test DMARC report via SMTP")
    parser.add_argument("--host", default="localhost", help="SMTP Host")
    parser.add_argument("--port", type=int, default=13062, help="SMTP Port")
    parser.add_argument("--domain", required=True, help="Domain to report for")
    parser.add_argument("--to", required=True, help="Recipient address")
    parser.add_argument("--no-test", action="store_false", dest="is_test", help="Don't flag as test data")
    
    args = parser.parse_args()
    send_test_report(args.host, args.port, args.domain, args.to, args.is_test)
