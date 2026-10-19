from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Counter = Annotated[int, Field(ge=0, le=2147483647, strict=True)]


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
    operation: Literal["transfer", "send_refill", "return_refill", "remove", "defective", "write_off", "refill_deadline"]
    date: date
    destination: Destination | None = None
    contractor: str | None = Field(default=None, min_length=1, max_length=255)
    result: Literal["ready", "defective"] = "ready"
    notes: str | None = Field(default=None, max_length=4000)
    expected_return_date: date | None = None
    page_counters: dict[int, Counter] = Field(default_factory=dict)

    @model_validator(mode="after")
    def tracking_fields(self):
        if self.expected_return_date is not None and self.operation not in {"send_refill", "refill_deadline"}:
            raise ValueError("Срок возврата указывается только для заправки")
        if self.operation == "send_refill" and self.expected_return_date and self.expected_return_date < self.date:
            raise ValueError("Срок возврата не может быть раньше отправки")
        if self.page_counters and (self.operation != "remove" or not set(self.page_counters).issubset(self.item_ids)):
            raise ValueError("Счётчики можно указать только для выбранных снимаемых картриджей")
        return self

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
    page_counter: Counter | None = None


class CompatibleDevice(Input):
    manufacturer: str = Field(min_length=1, max_length=255)
    model: str = Field(min_length=1, max_length=255)


class CompatibilityInput(Input):
    cartridge_model: str = Field(min_length=1, max_length=255)
    devices: list[CompatibleDevice] = Field(default_factory=list, max_length=200)
