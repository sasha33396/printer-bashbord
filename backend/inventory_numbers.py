import re
from threading import Lock
from typing import Optional

from sqlalchemy.orm import Session


INVENTORY_PREFIX = "1"
INVENTORY_DIGITS = 5
INVENTORY_LIMIT = 10 ** INVENTORY_DIGITS - 1
INVENTORY_PATTERN = re.compile(rf"^{INVENTORY_PREFIX}-(\d{{{INVENTORY_DIGITS}}})$")

inventory_number_lock = Lock()


def inventory_sequence(value: Optional[str]) -> Optional[int]:
    match = INVENTORY_PATTERN.fullmatch((value or "").strip())
    if not match:
        return None
    sequence = int(match.group(1))
    return sequence if sequence > 0 else None


def format_inventory_number(sequence: int) -> str:
    if sequence < 1 or sequence > INVENTORY_LIMIT:
        raise ValueError("Закончился диапазон инвентарных номеров")
    return f"{INVENTORY_PREFIX}-{sequence:0{INVENTORY_DIGITS}d}"


def require_inventory_number(value: str) -> str:
    value = (value or "").strip()
    if inventory_sequence(value) is None:
        raise ValueError(f"Инвентарный номер должен иметь вид {INVENTORY_PREFIX}-00001")
    return value


def used_inventory_numbers(db: Session) -> set[str]:
    from models import Device, WarehouseItem

    device_numbers = db.query(Device.inventory_number).filter(Device.inventory_number.isnot(None)).all()
    item_numbers = db.query(WarehouseItem.inventory_number).filter(
        WarehouseItem.inventory_number.isnot(None)
    ).all()
    return {
        value.strip()
        for (value,) in [*device_numbers, *item_numbers]
        if value and value.strip()
    }


def next_inventory_number(db: Session) -> str:
    used_sequences = {
        sequence
        for value in used_inventory_numbers(db)
        if (sequence := inventory_sequence(value)) is not None
    }
    for sequence in range(1, INVENTORY_LIMIT + 1):
        if sequence not in used_sequences:
            return format_inventory_number(sequence)
    raise ValueError("Закончился диапазон инвентарных номеров")


def inventory_number_owner(
    db: Session,
    value: str,
    *,
    exclude_device_id: Optional[int] = None,
    exclude_item_id: Optional[int] = None,
) -> Optional[str]:
    from models import Device, WarehouseItem

    device_query = db.query(Device.id).filter(Device.inventory_number == value)
    if exclude_device_id is not None:
        device_query = device_query.filter(Device.id != exclude_device_id)
    if device_query.first():
        return "device"

    item_query = db.query(WarehouseItem.id).filter(WarehouseItem.inventory_number == value)
    if exclude_item_id is not None:
        item_query = item_query.filter(WarehouseItem.id != exclude_item_id)
    if item_query.first():
        return "warehouse_item"
    return None


def migrate_inventory_numbers(db: Session) -> list[tuple[str, int, str, str]]:
    from models import Device, WarehouseItem

    entries = [
        ("device", item.id, item, item.inventory_number)
        for item in db.query(Device).order_by(Device.id).all()
    ]
    entries.extend(
        ("warehouse_item", item.id, item, item.inventory_number)
        for item in db.query(WarehouseItem)
        .filter(WarehouseItem.inventory_number.isnot(None))
        .order_by(WarehouseItem.id)
        .all()
        if item.inventory_number and item.inventory_number.strip()
    )

    used: set[str] = set()
    pending = []
    changes: list[tuple[str, int, str, str]] = []

    for entity_type, entity_id, entity, old_value in entries:
        value = (old_value or "").strip()
        if inventory_sequence(value) is not None and value not in used:
            used.add(value)
        else:
            pending.append((entity_type, entity_id, entity, value))

    unassigned = []
    for entity_type, entity_id, entity, old_value in pending:
        numeric_sequence = int(old_value) if old_value.isdigit() else None
        if numeric_sequence and numeric_sequence <= INVENTORY_LIMIT:
            numeric_candidate = format_inventory_number(numeric_sequence)
            if numeric_candidate not in used:
                used.add(numeric_candidate)
                entity.inventory_number = numeric_candidate
                changes.append((entity_type, entity_id, old_value, numeric_candidate))
                continue
        unassigned.append((entity_type, entity_id, entity, old_value))

    next_sequence = 1
    for entity_type, entity_id, entity, old_value in unassigned:
        try:
            while format_inventory_number(next_sequence) in used:
                next_sequence += 1
            candidate = format_inventory_number(next_sequence)
        except ValueError as exc:
            raise ValueError("Закончился диапазон инвентарных номеров") from exc
        next_sequence += 1
        used.add(candidate)
        entity.inventory_number = candidate
        changes.append((entity_type, entity_id, old_value, candidate))

    return changes
