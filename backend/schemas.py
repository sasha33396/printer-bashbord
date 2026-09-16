from datetime import date
from typing import Optional
from pydantic import BaseModel, ConfigDict

from models import DeviceType, DeviceStatus, RepairType, ItemType


# ---------------------------------------------------------------------------
# Manufacturer
# ---------------------------------------------------------------------------

class ManufacturerCreate(BaseModel):
    name: str


class ManufacturerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# ---------------------------------------------------------------------------
# Branch
# ---------------------------------------------------------------------------

class BranchCreate(BaseModel):
    name: str
    address: Optional[str] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None


class BranchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: Optional[str] = None


# ---------------------------------------------------------------------------
# Department
# ---------------------------------------------------------------------------

class DepartmentCreate(BaseModel):
    name: str
    branch_id: Optional[int] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    branch_id: Optional[int] = None


class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    branch_id: Optional[int] = None
    branch: Optional[BranchRead] = None


# ---------------------------------------------------------------------------
# Device
# ---------------------------------------------------------------------------

class DeviceCreate(BaseModel):
    inventory_number: str
    serial_number: Optional[str] = None
    manufacturer: str
    model: str
    device_type: DeviceType
    department_id: Optional[int] = None
    location: Optional[str] = None
    purchase_date: Optional[date] = None
    warranty_until: Optional[date] = None
    status: DeviceStatus = DeviceStatus.active
    notes: Optional[str] = None


class DeviceUpdate(BaseModel):
    inventory_number: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    device_type: Optional[DeviceType] = None
    department_id: Optional[int] = None
    location: Optional[str] = None
    purchase_date: Optional[date] = None
    warranty_until: Optional[date] = None
    status: Optional[DeviceStatus] = None
    notes: Optional[str] = None


class DeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inventory_number: str
    serial_number: Optional[str] = None
    manufacturer: str
    model: str
    device_type: DeviceType
    department_id: Optional[int] = None
    department: Optional[DepartmentRead] = None   # включает вложенный Branch
    location: Optional[str] = None
    purchase_date: Optional[date] = None
    warranty_until: Optional[date] = None
    status: DeviceStatus
    notes: Optional[str] = None


# Краткое представление — используется внутри RepairRecord и ConsumableLog
class DeviceBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inventory_number: str
    manufacturer: str
    model: str
    device_type: DeviceType
    status: DeviceStatus


# ---------------------------------------------------------------------------
# RepairRecord
# ---------------------------------------------------------------------------

class RepairRecordCreate(BaseModel):
    device_id: int
    date: date
    repair_type: RepairType
    description: str
    contractor: Optional[str] = None
    cost: float = 0.0
    page_counter: Optional[int] = None
    notes: Optional[str] = None


class RepairRecordUpdate(BaseModel):
    device_id: Optional[int] = None
    date: Optional[date] = None
    repair_type: Optional[RepairType] = None
    description: Optional[str] = None
    contractor: Optional[str] = None
    cost: Optional[float] = None
    page_counter: Optional[int] = None
    notes: Optional[str] = None


class RepairRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    device: DeviceBrief
    date: date
    repair_type: RepairType
    description: str
    contractor: Optional[str] = None
    cost: float
    page_counter: Optional[int] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# ConsumableLog
# ---------------------------------------------------------------------------

class ConsumableLogCreate(BaseModel):
    device_id: int
    date: date
    item_type: ItemType
    quantity: int = 1
    unit_cost: float = 0.0
    page_counter: Optional[int] = None
    notes: Optional[str] = None


class ConsumableLogUpdate(BaseModel):
    device_id: Optional[int] = None
    date: Optional[date] = None
    item_type: Optional[ItemType] = None
    quantity: Optional[int] = None
    unit_cost: Optional[float] = None
    page_counter: Optional[int] = None
    notes: Optional[str] = None


class ConsumableLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    device: DeviceBrief
    date: date
    item_type: ItemType
    quantity: int
    unit_cost: float
    page_counter: Optional[int] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Auth (оставлено без изменений)
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str
    password: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_active: bool
    is_admin: bool


class Token(BaseModel):
    access_token: str
    token_type: str
