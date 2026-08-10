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
        resolver = dns.resolver.Resolver()
        resolver.timeout = 2.0
        resolver.lifetime = 4.0
        answers = resolver.resolve(name, 'TXT')
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

def get_dmarc_record(domain: str) -> dict:
    cache_key = f"dns:dmarc:{domain}"
    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    records = query_txt(f"_dmarc.{domain}")
    dmarc_records = [r for r in records if r.startswith("v=DMARC1")]
    
    parsed_policy = "none"
    external_destinations = []
    
    # Per RFC 7489, if zero or multiple DMARC records exist, the domain is considered unconfigured / invalid.
    if len(dmarc_records) == 1:
        tags = [t.strip() for t in dmarc_records[0].split(';') if t.strip()]
        for tag in tags:
            if '=' in tag:
                k, v = tag.split('=', 1)
                if k.strip().lower() == 'p':
                    pol = v.strip().lower()
                    if pol in ("none", "quarantine", "reject"):
                        parsed_policy = pol
                    break

        external_destinations = check_external_dmarc_authorization(domain, dmarc_records[0])

    result = {
        "status": "Set" if len(dmarc_records) == 1 else "Not Set",
        "policy": parsed_policy if len(dmarc_records) == 1 else "none",
        "records": dmarc_records,
        "external_destinations": external_destinations
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result

PROVIDER_SELECTOR_MAP = {
    "outlook.com": ["selector1", "selector2"],
    "protection.outlook.com": ["selector1", "selector2"],
    "google.com": ["google", "20230601", "20210112"],
    "sendgrid.net": ["s1", "s2"],
    "mcsv.net": ["k1", "k2"],
    "postmarkapp.com": ["20150310", "pm"],
    "amazonses.com": ["7v7523u", "amazonses"]
}

def get_dkim_status_heuristic(domain: str, db_selectors: list[str] | None = None) -> dict:
    if db_selectors:
        sorted_sels = ",".join(sorted(set(db_selectors)))
        cache_key = f"dns:dkim:{domain}:learned:{sorted_sels}"
    else:
        cache_key = f"dns:dkim:{domain}"

    cached = r_cache.get(cache_key)
    if cached:
        return json.loads(cached)

    selectors_to_check = list(COMMON_DKIM_SELECTORS[:6]) # Base common selectors
    
    # 1. Include learned selectors from DB/DMARC reports
    if db_selectors:
        for sel in db_selectors:
            if sel and sel not in selectors_to_check:
                selectors_to_check.append(sel)
                
    # 2. Inspect SPF includes to infer active provider selectors (e.g. Microsoft 365 selector1 & selector2)
    spf_info = get_spf_record(domain)
    spf_records = spf_info.get("records", [])
    if spf_records:
        spf_str = " ".join(spf_records).lower()
        for domain_pattern, provider_selectors in PROVIDER_SELECTOR_MAP.items():
            if domain_pattern in spf_str:
                for p_sel in provider_selectors:
                    if p_sel not in selectors_to_check:
                        selectors_to_check.append(p_sel)

    found_selectors = []
    
    for selector in selectors_to_check:
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
        "checked_selectors": selectors_to_check,
        "is_heuristic": True
    }
    r_cache.setex(cache_key, 3600, json.dumps(result)) # 1h cache
    return result
