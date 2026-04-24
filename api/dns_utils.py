import dns.resolver
import json
import redis
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_cache = redis.from_url(REDIS_URL)

COMMON_DKIM_SELECTORS = [
    "default", "google", "mail", "dkim", "smtp", "mta", "selector1", "k1", "mandrill", "s1", "s2"
]

def query_txt(name):
    try:
        answers = dns.resolver.resolve(name, 'TXT')
        return [str(txt).strip('"') for txt in answers]
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers, Exception):
        return []

def get_spf_record(domain):
    cache_key = f"dns:spf:{domain}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    records = query_txt(domain)
    spf_records = [r for r in records if r.startswith("v=spf1")]
    
    result = {
        "status": "Set" if spf_records else "Not Set",
        "records": spf_records
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result

def get_dmarc_record(domain):
    cache_key = f"dns:dmarc:{domain}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    records = query_txt(f"_dmarc.{domain}")
    dmarc_records = [r for r in records if r.startswith("v=DMARC1")]
    
    result = {
        "status": "Set" if dmarc_records else "Not Set",
        "records": dmarc_records
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result

def get_dkim_status_heuristic(domain):
    cache_key = f"dns:dkim:{domain}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    found_selectors = []
    checked_selectors = COMMON_DKIM_SELECTORS[:8] # Limit for performance
    
    for selector in checked_selectors:
        target = f"{selector}._domainkey.{domain}"
        records = query_txt(target)
        if records:
            found_selectors.append({
                "selector": selector,
                "record": records[0]
            })
    
    result = {
        "status": "Set" if found_selectors else "Not Set",
        "found_selectors": found_selectors,
        "checked_selectors": checked_selectors,
        "is_heuristic": True
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result
