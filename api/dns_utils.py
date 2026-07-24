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

def _get_org_domain(domain):
    parts = domain.lower().strip('.').split('.')
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return domain.lower()

def check_external_dmarc_authorization(source_domain, dmarc_record):
    import re
    destinations = []
    source_org = _get_org_domain(source_domain)
    for tag in ['rua', 'ruf']:
        match = re.search(r'\b' + tag + r'\s*=\s*([^;]+)', dmarc_record, re.IGNORECASE)
        if match:
            uris = match.group(1).split(',')
            for uri in uris:
                uri = uri.strip()
                if uri.lower().startswith('mailto:'):
                    email = uri[7:]
                    if '@' in email:
                        dest_domain = email.split('@')[1].split('?')[0].lower().strip()
                        dest_org = _get_org_domain(dest_domain)
                        if dest_org != source_org:
                            destinations.append((tag, dest_domain))
    
    auth_results = []
    for tag, dest_domain in destinations:
        required_host = f"{source_domain.lower()}._report._dmarc.{dest_domain}"
        txt_records = query_txt(required_host)
        is_authorized = False
        record_value = None
        for r in txt_records:
            cleaned = r.strip()
            # Split tags by semicolon
            tags = [t.strip() for t in cleaned.split(';') if t.strip()]
            if tags:
                first_tag = tags[0]
                if '=' in first_tag:
                    k, v = first_tag.split('=', 1)
                    if k.strip().lower() == 'v' and v.strip().lower() == 'dmarc1':
                        is_authorized = True
                        record_value = r
                        break
        
        auth_results.append({
            "destination_domain": dest_domain,
            "type": tag,
            "is_authorized": is_authorized,
            "required_record": required_host,
            "record_value": record_value,
            "message": f'{tag} sends reports to external domain "{dest_domain}". The external domain must publish a DNS record at "{required_host}" to authorize receiving reports.'
        })
    return auth_results

def get_dmarc_record(domain):
    cache_key = f"dns:dmarc:{domain}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    records = query_txt(f"_dmarc.{domain}")
    dmarc_records = [r for r in records if r.startswith("v=DMARC1")]
    
    external_destinations = []
    if dmarc_records:
        external_destinations = check_external_dmarc_authorization(domain, dmarc_records[0])

    result = {
        "status": "Set" if dmarc_records else "Not Set",
        "records": dmarc_records,
        "external_destinations": external_destinations
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
            record = records[0]
            is_revoked = False
            tags = [t.strip() for t in record.split(';') if t.strip()]
            for tag in tags:
                if '=' in tag:
                    k, v = tag.split('=', 1)
                    if k.strip() == 'p' and v.strip() == '':
                        is_revoked = True
                        break
            
            found_selectors.append({
                "selector": selector,
                "record": record,
                "is_revoked": is_revoked
            })
    
    result = {
        "status": "Set" if found_selectors else "Not Set",
        "found_selectors": found_selectors,
        "checked_selectors": checked_selectors,
        "is_heuristic": True
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result
