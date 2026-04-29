import os
import json
import redis
from ipwhois import IPWhois
from datetime import timedelta

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_cache = redis.from_url(REDIS_URL)

def get_ip_enrichment(ip_address: str):
    cache_key = f"ip:enrich:{ip_address}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        obj = IPWhois(ip_address)
        # Using rdap instead of whois for more structured data
        results = obj.lookup_rdap(depth=1)
        
        asn = results.get('asn', 'Unknown')
        asn_description = results.get('asn_description', 'Unknown')
        
        # Get organization name from network details
        network = results.get('network', {})
        org = network.get('name', 'Unknown')
        country = network.get('country', 'Unknown')
        cidr = network.get('cidr', 'Unknown')

        enrichment = {
            "ip": ip_address,
            "asn": asn,
            "asn_org": asn_description,
            "org_name": org,
            "country": country,
            "network": cidr
        }
        
        # Cache for 24 hours to reduce overhead
        r_cache.setex(cache_key, 86400, json.dumps(enrichment))
        return enrichment
    except Exception as e:
        print(f"IP enrichment failed for {ip_address}: {e}")
        return {
            "ip": ip_address,
            "asn": "Unknown",
            "asn_org": "Unknown",
            "org_name": "Unknown",
            "country": "Unknown",
            "network": "Unknown",
            "error": str(e)
        }
