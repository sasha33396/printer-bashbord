from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CartridgeCreate(Input):
    inventory_numbers: list[str] = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    compatible_printers: str | None = Field(default=None, max_length=2000)
    branch_id: int
    department_id: int | None = None
    date: date
    state: Literal["ready", "empty", "defective"] = "ready"
    source_item_id: int | None = None
    notes: str | None = Field(default=None, max_length=4000)


class Destination(Input):
    holder_type: Literal["warehouse", "employee", "department"] = "warehouse"
    branch_id: int
    department_id: int | None = None
    employee_id: int | None = None


class CartridgeAction(Input):
    item_ids: list[int] = Field(min_length=1, max_length=100)
    operation: Literal["transfer", "send_refill", "return_refill", "remove", "defective", "write_off"]
    date: date
    destination: Destination | None = None
    contractor: str | None = Field(default=None, min_length=1, max_length=255)
    result: Literal["ready", "defective"] = "ready"
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("item_ids")
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Картридж выбран несколько раз")
        return value


class CartridgeInstall(Input):
    item_id: int
    device_id: int
    slot: str = Field(default="Основной", min_length=1, max_length=100)
    removed_item_id: int | None = None
    date: date
    destination: Destination
    notes: str | None = Field(default=None, max_length=4000)
