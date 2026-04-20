from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime

class Domain(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    is_active: bool = Field(default=True)
    dmarc_policy: Optional[str] = Field(default=None) # p=none, quarantine, reject

class ReportMetadata(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_name: str = Field(index=True)
    email: str
    report_id: str = Field(unique=True, index=True)
    date_begin: datetime
    date_end: datetime
    
    records: List["ReportRecord"] = Relationship(back_populates="report")

class ReportRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="reportmetadata.id")
    source_ip: str = Field(index=True)
    count: int
    
    # Policy Evaluation Results
    disposition: str # none, quarantine, reject
    dkim_pass: bool
    spf_pass: bool
    
    report: ReportMetadata = Relationship(back_populates="records")

# Database initialization logic would go here
# engine = create_engine(DB_DSN)
# SQLModel.metadata.create_all(engine)
