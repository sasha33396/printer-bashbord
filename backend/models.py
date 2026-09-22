import enum
from sqlalchemy import (
    Column, Integer, String, Float, Date, Text,
    ForeignKey, UniqueConstraint, Enum as SAEnum,
)
from sqlalchemy.orm import relationship

from database import Base


class DeviceType(str, enum.Enum):
    printer = "printer"
    mfc = "mfc"
    plotter = "plotter"
    scanner = "scanner"


class DeviceStatus(str, enum.Enum):
    active = "active"
    repair = "repair"
    decommissioned = "decommissioned"


class RepairType(str, enum.Enum):
    planned = "planned"
    unplanned = "unplanned"
    warranty = "warranty"


class ItemType(str, enum.Enum):
    toner_black = "toner_black"
    toner_color = "toner_color"
    drum = "drum"
    fuser = "fuser"
    other = "other"


class Manufacturer(Base):
    __tablename__ = "manufacturers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)


class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    address = Column(String(500))

    departments = relationship("Department", back_populates="branch")


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)

    branch = relationship("Branch", back_populates="departments")
    devices = relationship("Device", back_populates="department")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    inventory_number = Column(String(100), nullable=False, unique=True, index=True)
    serial_number = Column(String(100), unique=True, nullable=True, index=True)
    ip_address = Column(String(45), nullable=True)
    page_counter = Column(Integer, nullable=True)
    counter_checked_at = Column(String(40), nullable=True)
    manufacturer = Column(String(255), nullable=False)
    model = Column(String(255), nullable=False)
    device_type = Column(SAEnum(DeviceType), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    location = Column(String(500))
    purchase_date = Column(Date, nullable=True)
    warranty_until = Column(Date, nullable=True)
    status = Column(SAEnum(DeviceStatus), nullable=False, default=DeviceStatus.active)
    notes = Column(Text)

    department = relationship("Department", back_populates="devices")
    repair_records = relationship("RepairRecord", back_populates="device", cascade="all, delete-orphan")
    consumable_logs = relationship("ConsumableLog", back_populates="device", cascade="all, delete-orphan")


class RepairRecord(Base):
    __tablename__ = "repair_records"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    repair_type = Column(SAEnum(RepairType), nullable=False)
    description = Column(Text, nullable=False)
    contractor = Column(String(255))
    cost = Column(Float, default=0.0)
    page_counter = Column(Integer, nullable=True)
    notes = Column(Text)

    device = relationship("Device", back_populates="repair_records")


class ConsumableLog(Base):
    __tablename__ = "consumable_logs"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    item_type = Column(SAEnum(ItemType), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    unit_cost = Column(Float, default=0.0)
    page_counter = Column(Integer, nullable=True)
    notes = Column(Text)

    device = relationship("Device", back_populates="consumable_logs")
