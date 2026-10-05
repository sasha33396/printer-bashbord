from datetime import datetime
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator

from schemas import ADLogin, ADDomain, ADGuid, IPAddress, MACAddress


def external_id(value):
    if value is None or isinstance(value, bool):
        raise ValueError("Укажите ID записи OCS")
    return str(value).strip()


ExternalID = Annotated[str, BeforeValidator(external_id)]


class ImportAssetData(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    item_id: Optional[int] = Field(default=None, gt=0)
    manufacturer: Optional[str] = Field(default=None, max_length=255)
    model: Optional[str] = Field(default=None, max_length=255)
    serial_number: Optional[str] = Field(default=None, max_length=100)


class ImportComputerData(ImportAssetData):
    os_name: Optional[str] = Field(default=None, max_length=255)
    os_version: Optional[str] = Field(default=None, max_length=100)
    ip_address: IPAddress = None
    mac_address: MACAddress = None
    ram_gb: Optional[int] = Field(default=None, ge=0)
    processor: Optional[str] = Field(default=None, max_length=255)
    graphics: Optional[str] = Field(default=None, max_length=255)
    storage_type: Optional[str] = Field(default=None, max_length=50)
    storage_capacity_gb: Optional[int] = Field(default=None, ge=0)


class ImportMonitorData(ImportAssetData):
    ocs_id: ExternalID = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    monitor_diagonal: Optional[float] = Field(default=None, gt=0)


class OcsAdImportRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    ocs_id: ExternalID = Field(min_length=1, max_length=100)
    computer_name: str = Field(min_length=1, max_length=255)
    last_inventory_at: datetime
    domain: ADDomain = Field(default=None, max_length=255)
    ad_login: ADLogin = Field(default=None, max_length=255)
    ad_guid: ADGuid = None
    employee_id: Optional[int] = Field(default=None, gt=0)
    full_name: Optional[str] = Field(default=None, max_length=255)
    ad_enabled: Optional[bool] = None
    position: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=100)
    branch_id: Optional[int] = Field(default=None, gt=0)
    department_id: Optional[int] = Field(default=None, gt=0)
    computer: ImportComputerData = Field(default_factory=ImportComputerData)
    monitors: list[ImportMonitorData] = Field(default_factory=list, max_length=20)

    @field_validator("computer_name")
    @classmethod
    def normalize_name(cls, value):
        return value.upper()

    @field_validator("last_inventory_at")
    @classmethod
    def require_timezone(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Дата инвентаризации должна содержать часовой пояс")
        return value


class OcsAdImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source: Literal["ocs"] = "ocs"
    source_key: str = Field(default="main", min_length=1, max_length=100)
    dry_run: bool = True
    max_age_days: int = Field(default=30, ge=1, le=3650)
    records: list[OcsAdImportRecord] = Field(min_length=1, max_length=500)

    @field_validator("source_key")
    @classmethod
    def normalize_source(cls, value):
        return value.lower()


class OcsImportRecordResult(BaseModel):
    index: int
    ocs_id: str
    computer_name: str
    status: Literal["created", "updated", "unchanged", "skipped", "conflict"]
    employee_id: Optional[int] = None
    workplace_id: Optional[int] = None
    computer_item_id: Optional[int] = None
    monitor_item_ids: list[int] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    message: Optional[str] = None


class OcsAdImportResponse(BaseModel):
    run_id: Optional[str] = None
    dry_run: bool
    processed: int
    employees_created: int = 0
    employees_updated: int = 0
    workplaces_created: int = 0
    computers_created: int = 0
    computers_updated: int = 0
    monitors_created: int = 0
    monitors_updated: int = 0
    assets_assigned: int = 0
    warnings: int = 0
    conflicts: int = 0
    skipped: int = 0
    unchanged: int = 0
    records: list[OcsImportRecordResult] = Field(default_factory=list)
