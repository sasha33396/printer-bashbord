from datetime import date as Date, datetime as DateTime
from typing import Annotated, Any, Dict, List, Literal, Optional
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from network import normalize_ip_address
from models import (
    DeviceType, DeviceStatus, RepairType, RepairStatus, ItemType, StockMovementType,
    WorkplaceStatus,
)

IPAddress = Annotated[Optional[str], BeforeValidator(normalize_ip_address)]


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
    ip_address: IPAddress = None
    inventory_number: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: str
    model: str
    device_type: DeviceType
    department_id: Optional[int] = None
    location: Optional[str] = None
    purchase_date: Optional[Date] = None
    warranty_until: Optional[Date] = None
    status: DeviceStatus = DeviceStatus.active
    notes: Optional[str] = None


class DeviceUpdate(BaseModel):
    ip_address: IPAddress = None
    inventory_number: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    device_type: Optional[DeviceType] = None
    department_id: Optional[int] = None
    location: Optional[str] = None
    purchase_date: Optional[Date] = None
    warranty_until: Optional[Date] = None
    status: Optional[DeviceStatus] = None
    notes: Optional[str] = None


class DeviceRead(BaseModel):
    ip_address: IPAddress = None
    page_counter: Optional[int] = None
    counter_checked_at: Optional[str] = None
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
    purchase_date: Optional[Date] = None
    warranty_until: Optional[Date] = None
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


class InventoryLookupRead(BaseModel):
    entity_type: Literal["device", "warehouse_item"]
    id: int
    inventory_number: str
    path: str


# ---------------------------------------------------------------------------
# RepairRecord
# ---------------------------------------------------------------------------

class RepairWorkItemInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    description: str = Field(min_length=1)
    cost: float = Field(default=0.0, ge=0)


class RepairWorkItemRead(RepairWorkItemInput):
    model_config = ConfigDict(from_attributes=True)

    id: int


class RepairRecordCreate(BaseModel):
    device_id: int
    date: Date
    repair_type: RepairType
    repair_status: RepairStatus = RepairStatus.in_progress
    task_date: Optional[Date] = None
    task_url: Optional[str] = Field(default=None, max_length=1000)
    source_location: Optional[str] = Field(default=None, max_length=500)
    responsible_person: Optional[str] = Field(default=None, max_length=255)
    returned_date: Optional[Date] = None
    connected_date: Optional[Date] = None
    description: str
    contractor: Optional[str] = None
    cost: float = Field(default=0.0, ge=0)
    page_counter: Optional[int] = None
    completion_page_counter: Optional[int] = Field(default=None, ge=0)
    work_items: List[RepairWorkItemInput] = Field(default_factory=list)
    notes: Optional[str] = None


class RepairRecordUpdate(BaseModel):
    device_id: Optional[int] = None
    date: Optional[Date] = None
    repair_type: Optional[RepairType] = None
    repair_status: Optional[RepairStatus] = None
    task_date: Optional[Date] = None
    task_url: Optional[str] = Field(default=None, max_length=1000)
    source_location: Optional[str] = Field(default=None, max_length=500)
    responsible_person: Optional[str] = Field(default=None, max_length=255)
    returned_date: Optional[Date] = None
    connected_date: Optional[Date] = None
    description: Optional[str] = None
    contractor: Optional[str] = None
    cost: Optional[float] = Field(default=None, ge=0)
    page_counter: Optional[int] = None
    completion_page_counter: Optional[int] = Field(default=None, ge=0)
    work_items: Optional[List[RepairWorkItemInput]] = None
    notes: Optional[str] = None


class RepairRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    device: DeviceBrief
    date: Date
    repair_type: RepairType
    repair_status: RepairStatus
    task_date: Optional[Date] = None
    task_url: Optional[str] = None
    source_location: Optional[str] = None
    responsible_person: Optional[str] = None
    returned_date: Optional[Date] = None
    connected_date: Optional[Date] = None
    description: str
    contractor: Optional[str] = None
    cost: float
    page_counter: Optional[int] = None
    completion_page_counter: Optional[int] = None
    page_counter_delta: Optional[int] = None
    invoice_name: Optional[str] = None
    work_items: List[RepairWorkItemRead] = Field(default_factory=list)
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# ConsumableLog
# ---------------------------------------------------------------------------

class ConsumableLogCreate(BaseModel):
    device_id: int
    date: Date
    item_type: ItemType
    quantity: int = 1
    unit_cost: float = 0.0
    page_counter: Optional[int] = None
    notes: Optional[str] = None


class ConsumableLogUpdate(BaseModel):
    device_id: Optional[int] = None
    date: Optional[Date] = None
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
    date: Date
    item_type: ItemType
    quantity: int
    unit_cost: float
    page_counter: Optional[int] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Warehouse
# ---------------------------------------------------------------------------

class WarehouseItemCreate(BaseModel):
    sku: Optional[str] = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(min_length=1, max_length=100)
    branch_id: int
    department_id: Optional[int] = None
    tracking_type: str = Field(default="quantity", pattern="^(quantity|asset)$")
    inventory_number: Optional[str] = Field(default=None, max_length=100)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=255)
    model: Optional[str] = Field(default=None, max_length=255)
    placement: str = Field(default="Склад/серверная", min_length=1, max_length=100)
    condition: str = Field(default="На складе", min_length=1, max_length=50)
    compatible_printers: Optional[str] = None
    monitor_diagonal: Optional[float] = Field(default=None, gt=0)
    color: Optional[str] = Field(default=None, max_length=50)
    ram_gb: Optional[int] = Field(default=None, ge=0)
    processor: Optional[str] = Field(default=None, max_length=255)
    graphics: Optional[str] = Field(default=None, max_length=255)
    storage_type: Optional[str] = Field(default=None, max_length=50)
    storage_capacity_gb: Optional[int] = Field(default=None, ge=0)
    unit: str = Field(default="шт.", min_length=1, max_length=30)
    min_quantity: int = Field(default=0, ge=0)
    initial_quantity: int = Field(default=0, ge=0)
    notes: Optional[str] = None


class WarehouseItemUpdate(BaseModel):
    sku: Optional[str] = Field(default=None, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    category: Optional[str] = Field(default=None, min_length=1, max_length=100)
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    tracking_type: Optional[str] = Field(default=None, pattern="^(quantity|asset)$")
    inventory_number: Optional[str] = Field(default=None, max_length=100)
    serial_number: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=255)
    model: Optional[str] = Field(default=None, max_length=255)
    placement: Optional[str] = Field(default=None, min_length=1, max_length=100)
    condition: Optional[str] = Field(default=None, min_length=1, max_length=50)
    compatible_printers: Optional[str] = None
    monitor_diagonal: Optional[float] = Field(default=None, gt=0)
    color: Optional[str] = Field(default=None, max_length=50)
    ram_gb: Optional[int] = Field(default=None, ge=0)
    processor: Optional[str] = Field(default=None, max_length=255)
    graphics: Optional[str] = Field(default=None, max_length=255)
    storage_type: Optional[str] = Field(default=None, max_length=50)
    storage_capacity_gb: Optional[int] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=30)
    min_quantity: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None


class WarehouseWorkplaceBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class EquipmentPhotoRead(BaseModel):
    filename: str
    size: int
    created_at: DateTime


class WarehouseItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: Optional[str] = None
    name: str
    category: str
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    branch: Optional[BranchRead] = None
    department: Optional[DepartmentRead] = None
    tracking_type: str
    inventory_number: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    placement: str
    condition: str
    compatible_printers: Optional[str] = None
    monitor_diagonal: Optional[float] = None
    color: Optional[str] = None
    ram_gb: Optional[int] = None
    processor: Optional[str] = None
    graphics: Optional[str] = None
    storage_type: Optional[str] = None
    storage_capacity_gb: Optional[int] = None
    unit: str
    min_quantity: int
    current_quantity: int
    notes: Optional[str] = None
    workplace: Optional[WarehouseWorkplaceBrief] = None
    responsible_person: Optional[str] = None
    is_archived: bool = False
    archived_at: Optional[DateTime] = None


class StockMovementCreate(BaseModel):
    date: Date
    movement_type: StockMovementType
    quantity: int = Field(gt=0)
    notes: Optional[str] = None


class StockMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    date: Date
    movement_type: StockMovementType
    quantity: int
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------

class EmployeeCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    position: Optional[str] = Field(default=None, max_length=255)
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    phone: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True
    notes: Optional[str] = None


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    position: Optional[str] = Field(default=None, max_length=255)
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    phone: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class EmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    position: Optional[str] = None
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    branch: Optional[BranchRead] = None
    department: Optional[DepartmentRead] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Workplaces
# ---------------------------------------------------------------------------

class WorkplaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    branch_id: int
    department_id: Optional[int] = None
    location: Optional[str] = Field(default=None, max_length=255)
    employee_id: Optional[int] = None
    status: WorkplaceStatus = WorkplaceStatus.vacant
    notes: Optional[str] = None


class WorkplaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    location: Optional[str] = Field(default=None, max_length=255)
    employee_id: Optional[int] = None
    status: Optional[WorkplaceStatus] = None
    notes: Optional[str] = None


class WorkplacePhotoSelect(BaseModel):
    item_id: int
    filename: str = Field(min_length=1, max_length=255)


class WorkplaceAssetBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str
    inventory_number: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    condition: str


class WorkplaceAssignmentCreate(BaseModel):
    item_id: int
    assigned_at: Date
    notes: Optional[str] = None


class WorkplaceAssignmentEnd(BaseModel):
    ended_at: Date
    notes: Optional[str] = None


class WorkplaceTransfer(BaseModel):
    workplace_id: int
    transfer_date: Date
    notes: Optional[str] = None


class WorkplaceAssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workplace_id: int
    item_id: int
    assigned_at: Date
    ended_at: Optional[Date] = None
    notes: Optional[str] = None
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    inventory_number: Optional[str] = None
    item_name: Optional[str] = None
    item_category: Optional[str] = None
    workplace_name: Optional[str] = None
    branch_name: Optional[str] = None
    department_name: Optional[str] = None
    item: WorkplaceAssetBrief


class WorkplaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    employee_id: Optional[int] = None
    branch: Optional[BranchRead] = None
    department: Optional[DepartmentRead] = None
    employee: Optional[EmployeeRead] = None
    location: Optional[str] = None
    status: WorkplaceStatus
    notes: Optional[str] = None
    photo_item_id: Optional[int] = None
    has_photo: bool = False
    current_assets: List[WorkplaceAssignmentRead] = Field(default_factory=list)
    assignment_history: List[WorkplaceAssignmentRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Global equipment history
# ---------------------------------------------------------------------------

class EquipmentEventRead(BaseModel):
    id: int
    occurred_at: DateTime
    effective_date: Optional[Date] = None
    category: str
    event_type: str
    entity_type: str
    entity_id: Optional[int] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    inventory_number: Optional[str] = None
    entity_name: str
    title: str
    details: Optional[str] = None
    actor: Optional[str] = None
    branch_name: Optional[str] = None
    department_name: Optional[str] = None
    workplace_name: Optional[str] = None
    employee_name: Optional[str] = None
    from_value: Optional[str] = None
    to_value: Optional[str] = None
    changes: Dict[str, Any] = Field(default_factory=dict)


class EquipmentEventPage(BaseModel):
    total: int
    items: List[EquipmentEventRead]


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
