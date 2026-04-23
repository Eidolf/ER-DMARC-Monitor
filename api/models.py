from __future__ import annotations
from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    ADMIN = "Admin"
    ANALYST = "Analyst"
    READ_ONLY = "Read-only"

class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    username: str = Field(index=True, unique=True)
    hashed_password: str | None = Field(default=None)
    role: UserRole = Field(default=UserRole.READ_ONLY)
    is_active: bool = Field(default=True)
    
    # MFA
    mfa_enabled: bool = Field(default=False)
    mfa_secret: str | None = Field(default=None)
    
    # SSO (Entra ID)
    sso_provider: str | None = Field(default=None) # "entra"
    sso_id: str | None = Field(default=None, index=True) # Entra object ID
    
    # Audit
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: datetime | None = Field(default=None)

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

