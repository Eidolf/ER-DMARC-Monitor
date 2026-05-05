import os
import msal
from typing import Optional

# Scopes we need
SCOPES = ["User.Read"]

def get_msal_app(client_id: str = None, client_secret: str = None, tenant_id: str = None):
    # Fallback to env if not provided
    cid = client_id or os.getenv("ENTRA_CLIENT_ID")
    csec = client_secret or os.getenv("ENTRA_CLIENT_SECRET")
    tid = tenant_id or os.getenv("ENTRA_TENANT_ID", "common")
    
    if not cid or not csec:
        return None
        
    authority = f"https://login.microsoftonline.com/{tid}"
    
    return msal.ConfidentialClientApplication(
        cid,
        authority=authority,
        client_credential=csec,
    )

def get_auth_url(client_id: str = None, client_secret: str = None, tenant_id: str = None, redirect_uri: str = None):
    app = get_msal_app(client_id, client_secret, tenant_id)
    if not app:
        return None
    
    r_uri = redirect_uri or os.getenv("ENTRA_REDIRECT_URI", "http://localhost:8080/auth/sso/callback")
    return app.get_authorization_request_url(SCOPES, redirect_uri=r_uri)

def acquire_token_by_code(code: str, client_id: str = None, client_secret: str = None, tenant_id: str = None, redirect_uri: str = None):
    app = get_msal_app(client_id, client_secret, tenant_id)
    if not app:
        return None
    
    r_uri = redirect_uri or os.getenv("ENTRA_REDIRECT_URI", "http://localhost:8080/auth/sso/callback")
    result = app.acquire_token_by_authorization_code(
        code,
        scopes=SCOPES,
        redirect_uri=r_uri
    )
    return result

def validate_id_token(id_token_claims: dict):
    # Basic validation is handled by MSAL when it returns the result
    return {
        "sso_id": id_token_claims.get("oid") or id_token_claims.get("sub"),
        "email": id_token_claims.get("preferred_username") or id_token_claims.get("email"),
        "name": id_token_claims.get("name"),
    }
