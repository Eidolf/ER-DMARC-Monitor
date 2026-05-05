from __future__ import annotations
from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    ADMIN = "Admin"
    ANALYST = "Analyst"
    READ_ONLY = "Read-only"

class AuthSource(str, Enum):
    LOCAL = "LOCAL"
    ENTRA_ID = "ENTRA_ID"

class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    username: str = Field(index=True, unique=True)
    hashed_password: str | None = Field(default=None)
    role: UserRole = Field(default=UserRole.READ_ONLY)
    is_active: bool = Field(default=True)
    auth_source: AuthSource = Field(default=AuthSource.LOCAL)
    
    # MFA
    mfa_enabled: bool = Field(default=False)
    mfa_secret: str | None = Field(default=None)
    mfa_recovery_codes: str | None = Field(default=None) # JSON string
    
    # SSO (Entra ID)
    sso_provider: str | None = Field(default=None) # "entra"
    sso_id: str | None = Field(default=None, index=True) # Entra object ID
    
    # Audit
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: datetime | None = Field(default=None)
    last_login_ip: str | None = Field(default=None)
    last_login_method: str | None = Field(default=None) # "local", "entra"

class SystemSettings(SQLModel, table=True):
    id: int | None = Field(default=1, primary_key=True)
    
    # Auth Modes
    allow_local_login: bool = Field(default=True)
    allow_sso_login: bool = Field(default=True)
    enforce_mfa_admins: bool = Field(default=True)
    enforce_mfa_analysts: bool = Field(default=False)
    
    # Entra ID Config
    entra_tenant_id: str | None = Field(default=None)
    entra_client_id: str | None = Field(default=None)
    entra_client_secret: str | None = Field(default=None)
    entra_tenant_type: str = Field(default="single") 
    default_sso_role: UserRole = Field(default=UserRole.READ_ONLY)
    
    # Global Config
    public_url: str | None = Field(default=None) # e.g. https://dmarc.eidolf.de
    
    # Branding
    title_part1: str = Field(default="ER-DMARC")
    title_part2: str = Field(default="-Monitor")
    color_part1: str = Field(default="#e6edf3")
    color_part2: str = Field(default="#3b82f6")
    logo_url: str | None = Field(default=None)
    
    # SMTP Testing
    smtp_test_mode_enabled: bool = Field(default=False)
    allowed_test_recipients: str | None = Field(default=None)
    test_message_retention_days: int = Field(default=7)

class LoginAudit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    ip_address: str
    method: str # "local", "entra"
    status: str # "success", "failed", "mfa_pending"
    detail: str | None = Field(default=None)

class Domain(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    is_active: bool = Field(default=True)
    dmarc_policy: str | None = Field(default=None) # p=none, quarantine, reject

class ReportMetadata(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    org_name: str = Field(index=True)
    email: str
    report_id: str = Field(unique=True, index=True)
    date_begin: datetime
    date_end: datetime
    domain_name: str = Field(index=True, default="unknown")
    is_test: bool = Field(default=False, index=True)
    
    records: list[ReportRecord] = Relationship(sa_relationship=relationship("ReportRecord", back_populates="report"))

class ReportRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="reportmetadata.id")
    source_ip: str = Field(index=True)
    count: int
    
    # Policy Evaluation Results
    disposition: str # none, quarantine, reject
    dkim_pass: bool
    spf_pass: bool
    
    # Forensic Auth Details
    spf_auth_results: str | None = Field(default=None)   # JSON string of results
    dkim_auth_results: str | None = Field(default=None)  # JSON string of results
    
    report: ReportMetadata = Relationship(sa_relationship=relationship("ReportMetadata", back_populates="records"))


class SMTPListeningDomain(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    domain_name: str = Field(index=True, unique=True)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class SMTPRecipient(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    listening_domain_id: int = Field(foreign_key="smtplisteningdomain.id")
    local_part: str = Field(index=True) # e.g. "report"
    is_active: bool = Field(default=True)
    is_dmarc_compliant: bool = Field(default=True)
