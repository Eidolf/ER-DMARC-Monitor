from __future__ import annotations
from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy.orm import relationship
from datetime import datetime

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

# Database initialization logic would go here
# engine = create_engine(DB_DSN)
# SQLModel.metadata.create_all(engine)
