import json
from datetime import date, datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from models import (
    Department, Device, EquipmentEvent, RepairRecord, RepairStatus, StockMovement,
    StockMovementType, WarehouseItem, Workplace, WorkplaceAssetAssignment,
)


def actor_name(current_user: Optional[dict]) -> Optional[str]:
    if not current_user:
        return None
    return current_user.get("username")


def _value(value: Any):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def changed_values(before: dict, after: dict, labels: Optional[dict] = None) -> dict:
    result = {}
    labels = labels or {}
    for field, new_value in after.items():
        old_value = before.get(field)
        old_serialized = _value(old_value)
        new_serialized = _value(new_value)
        if old_serialized == new_serialized:
            continue
        result[labels.get(field, field)] = {
            "before": old_serialized,
            "after": new_serialized,
        }
    return result


def add_event(
    db: Session,
    *,
    category: str,
    event_type: str,
    entity_type: str,
    entity_id: Optional[int],
    entity_name: str,
    title: str,
    actor: Optional[str] = None,
    effective_date: Optional[date] = None,
    inventory_number: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[int] = None,
    details: Optional[str] = None,
    branch_name: Optional[str] = None,
    department_name: Optional[str] = None,
    workplace_name: Optional[str] = None,
    employee_name: Optional[str] = None,
    from_value: Optional[str] = None,
    to_value: Optional[str] = None,
    changes: Optional[dict] = None,
) -> EquipmentEvent:
    event = EquipmentEvent(
        category=category,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        reference_type=reference_type,
        reference_id=reference_id,
        inventory_number=inventory_number,
        entity_name=entity_name,
        title=title,
        details=details,
        actor=actor,
        effective_date=effective_date,
        branch_name=branch_name,
        department_name=department_name,
        workplace_name=workplace_name,
        employee_name=employee_name,
        from_value=from_value,
        to_value=to_value,
        changes_json=json.dumps(changes, ensure_ascii=False, default=str) if changes else None,
    )
    db.add(event)
    return event


def add_item_event(db: Session, item, **kwargs) -> EquipmentEvent:
    workplace = kwargs.pop("workplace", None)
    employee = kwargs.pop("employee", None)
    return add_event(
        db,
        entity_type="warehouse_item",
        entity_id=item.id,
        inventory_number=item.inventory_number,
        entity_name=item.name,
        branch_name=(workplace.branch.name if workplace and workplace.branch else None)
        or (item.branch.name if item.branch else None),
        department_name=(workplace.department.name if workplace and workplace.department else None)
        or (item.department.name if item.department else None),
        workplace_name=workplace.name if workplace else None,
        employee_name=(employee.full_name if employee else None),
        **kwargs,
    )


def add_device_event(db: Session, device, **kwargs) -> EquipmentEvent:
    department = device.department
    return add_event(
        db,
        entity_type="device",
        entity_id=device.id,
        inventory_number=device.inventory_number,
        entity_name=f"{device.manufacturer} {device.model}".strip(),
        branch_name=department.branch.name if department and department.branch else None,
        department_name=department.name if department else None,
        **kwargs,
    )


def event_changes(event: EquipmentEvent) -> dict:
    if not event.changes_json:
        return {}
    try:
        value = json.loads(event.changes_json)
        return value if isinstance(value, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def initialize_equipment_history(db: Session) -> None:
    history_exists = db.query(EquipmentEvent.id).first() is not None
    assignments = (
        db.query(WorkplaceAssetAssignment)
        .options(
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.branch),
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.department),
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.employee),
            joinedload(WorkplaceAssetAssignment.item),
        )
        .all()
    )
    for assignment in assignments:
        workplace = assignment.workplace
        assignment.inventory_number = assignment.inventory_number or assignment.item.inventory_number
        assignment.item_name = assignment.item_name or assignment.item.name
        assignment.item_category = assignment.item_category or assignment.item.category
        assignment.workplace_name = assignment.workplace_name or workplace.name
        assignment.branch_name = assignment.branch_name or (
            workplace.branch.name if workplace.branch else None
        )
        assignment.department_name = assignment.department_name or (
            workplace.department.name if workplace.department else None
        )
        if assignment.ended_at is None and workplace.employee:
            assignment.employee_id = workplace.employee.id
            assignment.employee_name = workplace.employee.full_name

    if history_exists:
        # Reconcile completed assignments on every startup. This also restores
        # detach events made by older application versions that only closed
        # the assignment period without writing to the global journal.
        for assignment in assignments:
            if assignment.ended_at is None:
                continue
            existing = db.query(EquipmentEvent.id).filter(
                EquipmentEvent.entity_type == "warehouse_item",
                EquipmentEvent.entity_id == assignment.item_id,
                EquipmentEvent.event_type == "returned_to_stock",
                EquipmentEvent.effective_date == assignment.ended_at,
                EquipmentEvent.workplace_name == assignment.workplace_name,
            ).first()
            if existing:
                continue
            add_event(
                db,
                category="workplace",
                event_type="returned_to_stock",
                entity_type="warehouse_item",
                entity_id=assignment.item_id,
                inventory_number=assignment.inventory_number or assignment.item.inventory_number,
                entity_name=assignment.item_name or assignment.item.name,
                title="Оборудование снято с рабочего места",
                actor="migration",
                effective_date=assignment.ended_at,
                reference_type="workplace_assignment",
                reference_id=assignment.id,
                branch_name=assignment.branch_name,
                department_name=assignment.department_name,
                workplace_name=assignment.workplace_name,
                employee_name=assignment.employee_name,
                from_value=assignment.workplace_name,
                to_value="Склад/серверная",
                details=assignment.notes,
            )
        db.commit()
        return

    items = (
        db.query(WarehouseItem)
        .options(joinedload(WarehouseItem.branch), joinedload(WarehouseItem.department))
        .all()
    )
    items_by_id = {item.id: item for item in items}
    for item in items:
        add_item_event(
            db,
            item,
            category="equipment",
            event_type="existing_record",
            title="Существующая карточка добавлена в журнал",
            actor="migration",
        )

    for movement in db.query(StockMovement).order_by(StockMovement.date, StockMovement.id).all():
        item = items_by_id.get(movement.item_id)
        if not item:
            continue
        add_item_event(
            db,
            item,
            category="stock",
            event_type="stock_received"
            if movement.movement_type == StockMovementType.receipt else "stock_issued",
            title="Поступление на склад"
            if movement.movement_type == StockMovementType.receipt else "Выдача со склада",
            actor="migration",
            effective_date=movement.date,
            details=f"Количество: {movement.quantity} {item.unit}. {movement.notes or ''}".strip(),
        )

    for assignment in assignments:
        item = items_by_id.get(assignment.item_id)
        if not item:
            continue
        add_event(
            db,
            category="workplace",
            event_type="assigned_to_workplace",
            entity_type="warehouse_item",
            entity_id=item.id,
            inventory_number=item.inventory_number,
            entity_name=item.name,
            title="Оборудование установлено на рабочее место",
            actor="migration",
            effective_date=assignment.assigned_at,
            branch_name=assignment.branch_name,
            department_name=assignment.department_name,
            workplace_name=assignment.workplace_name,
            employee_name=assignment.employee_name,
            from_value="Склад/серверная",
            to_value=assignment.workplace_name,
            details=assignment.notes,
        )
        if assignment.ended_at:
            add_event(
                db,
                category="workplace",
                event_type="returned_to_stock",
                entity_type="warehouse_item",
                entity_id=item.id,
                inventory_number=item.inventory_number,
                entity_name=item.name,
                title="Оборудование снято с рабочего места",
                actor="migration",
                effective_date=assignment.ended_at,
                reference_type="workplace_assignment",
                reference_id=assignment.id,
                branch_name=assignment.branch_name,
                department_name=assignment.department_name,
                workplace_name=assignment.workplace_name,
                employee_name=assignment.employee_name,
                from_value=assignment.workplace_name,
                to_value="Склад/серверная",
            )

    devices = (
        db.query(Device)
        .options(joinedload(Device.department).joinedload(Department.branch))
        .all()
    )
    devices_by_id = {device.id: device for device in devices}
    for device in devices:
        add_device_event(
            db,
            device,
            category="device",
            event_type="existing_record",
            title="Существующее устройство добавлено в журнал",
            actor="migration",
        )
    for repair in db.query(RepairRecord).order_by(RepairRecord.date, RepairRecord.id).all():
        device = devices_by_id.get(repair.device_id)
        if not device:
            continue
        add_device_event(
            db,
            device,
            category="repair",
            event_type="repair_completed"
            if repair.repair_status == RepairStatus.completed else "repair_created",
            title="Исторический ремонт добавлен в журнал",
            actor="migration",
            effective_date=repair.returned_date or repair.date,
            reference_type="repair",
            reference_id=repair.id,
            details=repair.description,
        )
    db.commit()
