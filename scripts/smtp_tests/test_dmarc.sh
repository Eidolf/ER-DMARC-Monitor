#!/bin/bash

# Simple SMTP test script using swaks or telnet
# Requirement: swaks (Swiss Army Knife for SMTP)

HOST=${1:-"localhost"}
PORT=${2:-13062}
DOMAIN=${3:-"test-domain.com"}
RECIPIENT=${4:-"report@dmarc.domain.com"}

echo "Sending test DMARC report to $HOST:$PORT for $DOMAIN..."

swaks --to "$RECIPIENT" \
      --from "tester@external.org" \
      --server "$HOST" \
      --port "$PORT" \
      --header "Subject: DMARC Test" \
      --header "X-DMARC-Test: true" \
      --attach-type "application/xml" \
      --attach "<?xml version='1.0'?><feedback><report_metadata><org_name>SWAKS-TEST</org_name><email>test@test.org</email><report_id>$(date +%s)</report_id><date_range><begin>$(date +%s -d '1 day ago')</begin><end>$(date +%s)</end></date_range></report_metadata><policy_published><domain>$DOMAIN</domain><p>none</p></policy_published><record><row><source_ip>1.1.1.1</source_ip><count>1</count><policy_evaluated><disposition>none</disposition></policy_evaluated></row></record></feedback>"

if [ $? -eq 0 ]; then
    echo "Message sent successfully."
else
    echo "Failed to send message. Is swaks installed?"
fi
