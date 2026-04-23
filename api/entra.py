import os
import msal
from typing import Optional

# Entra ID Config
CLIENT_ID = os.getenv("ENTRA_CLIENT_ID")
CLIENT_SECRET = os.getenv("ENTRA_CLIENT_SECRET")
TENANT_ID = os.getenv("ENTRA_TENANT_ID", "common") # "common" for multi-tenant
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
REDIRECT_URI = os.getenv("ENTRA_REDIRECT_URI", "http://localhost:8080/auth/sso/callback")

# Scopes we need
SCOPES = ["User.Read"]

def get_msal_app():
    if not CLIENT_ID or not CLIENT_SECRET:
        return None
    return msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET,
    )

def get_auth_url():
    app = get_msal_app()
    if not app:
        return None
    return app.get_authorization_request_url(SCOPES, redirect_uri=REDIRECT_URI)

def acquire_token_by_code(code: str):
    app = get_msal_app()
    if not app:
        return None
    result = app.acquire_token_by_authorization_code(
        code,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    return result

def validate_id_token(id_token_claims: dict):
    # Basic validation is handled by MSAL when it returns the result
    # We can perform additional checks here if needed (e.g. group membership)
    return {
        "sso_id": id_token_claims.get("oid") or id_token_claims.get("sub"),
        "email": id_token_claims.get("preferred_username") or id_token_claims.get("email"),
        "name": id_token_claims.get("name"),
    }
