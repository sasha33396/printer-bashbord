from datetime import datetime, timezone
from contextlib import contextmanager
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload, object_session
from sqlalchemy.orm.exc import StaleDataError

from cartridge_schemas import CartridgeAction, CartridgeCreate, CartridgeInstall, CompatibilityInput, Destination
from cartridge_tracking import cycle_pages, device_key, model_key, today as tracking_today, tracking
from database import get_db
from equipment_history import add_item_event
from inventory_numbers import inventory_number_lock, inventory_number_owner, require_inventory_number
from models import (
    Branch, Cartridge, CartridgeCompatibility, CartridgeOperation, Department, Device, DeviceStatus, DeviceType,
    Employee, StockMovement, StockMovementType, WarehouseItem, WorkplaceAssetAssignment,
)
from routers.auth import get_current_user
from routers.warehouse import _current_quantity

router = APIRouter()
AUTH = Depends(get_current_user)
STATES = {"ready": "Запасной", "installed": "Установлен", "empty": "Пустой",
          "refilling": "На заправке", "defective": "Неисправен", "written_off": "Списан"}
OPERATIONS = {"received": "Поступление картриджа", "registered": "Перевод в поштучный учёт",
              "transfer": "Передача картриджа", "install": "Установка картриджа",
              "remove": "Снятие картриджа", "send_refill": "Отправка на заправку",
              "return_refill": "Возврат с заправки", "defective": "Картридж неисправен",
              "write_off": "Списание картриджа", "refill_deadline": "Изменение срока возврата",
              "deleted": "Удаление карточки картриджа"}


def conflict(message):
    raise HTTPException(409, message)


def query(db):
    return db.query(Cartridge).filter(Cartridge.is_deleted.is_(False)).options(
        joinedload(Cartridge.item).joinedload(WarehouseItem.branch),
        joinedload(Cartridge.item).joinedload(WarehouseItem.department),
        joinedload(Cartridge.employee), joinedload(Cartridge.device),
        selectinload(Cartridge.operations),
    )


def get_cartridge(db, item_id):
    record = query(db).filter(Cartridge.item_id == item_id).first()
    if not record:
        raise HTTPException(404, "Картридж не найден")
    return record


def location(record):
    item = record.item
    parts = [item.branch.name if item.branch else None, item.department.name if item.department else None]
    if record.holder_type == "contractor":
        return f"Заправка: {record.contractor}"
    if record.holder_type == "employee":
        parts.append(record.employee.full_name if record.employee else "Сотрудник")
    elif record.holder_type == "warehouse":
        parts.append("Склад")
    if record.device:
        parts.append(f"{record.device.manufacturer} {record.device.model} ({record.slot})")
    return " / ".join(str(part) for part in parts if part)


def compatibility_catalog(db):
    catalog = {}
    for row in db.query(CartridgeCompatibility).order_by(CartridgeCompatibility.id).all():
        catalog.setdefault(row.cartridge_key, []).append({"manufacturer": row.manufacturer, "model": row.model})
    return catalog


def read(record, profiles=None):
    item = record.item
    if profiles is None:
        profiles = compatibility_catalog(object_session(record))
    return {
        "item_id": item.id, "inventory_number": item.inventory_number, "name": item.name,
        "compatible_printers": item.compatible_printers, "notes": item.notes,
        "compatible_models": profiles.get(model_key(item.name), []),
        **tracking(record),
        "branch_id": item.branch_id, "branch_name": item.branch.name if item.branch else None,
        "department_id": item.department_id, "department_name": item.department.name if item.department else None,
        "state": record.state, "holder_type": record.holder_type,
        "employee_id": record.employee_id, "employee_name": record.employee.full_name if record.employee else None,
        "contractor": record.contractor, "device_id": record.device_id,
        "device_name": f"{record.device.manufacturer} {record.device.model}" if record.device else None,
        "slot": record.slot, "location": location(record), "version": record.version,
        **{field: getattr(record, field) for field in (
            "last_operation_date", "last_installed_at", "last_removed_at", "last_refill_sent_at",
            "last_refill_returned_at", "refill_count",
        )},
    }


def destination(db, target):
    if target is None:
        raise HTTPException(422, "Укажите получателя")
    branch = db.get(Branch, target.branch_id)
    if not branch:
        raise HTTPException(422, "Филиал не найден")
    department = db.get(Department, target.department_id) if target.department_id else None
    if target.department_id and (not department or department.branch_id != branch.id):
        raise HTTPException(422, "Отдел не относится к выбранному филиалу")
    employee = db.get(Employee, target.employee_id) if target.employee_id else None
    if target.holder_type == "department" and not department:
        raise HTTPException(422, "Выберите отдел-получатель")
    if target.holder_type == "employee":
        if not employee or not employee.is_active:
            raise HTTPException(422, "Выберите активного сотрудника")
        if employee.branch_id != branch.id or employee.department_id != target.department_id:
            raise HTTPException(422, "Филиал и отдел должны соответствовать сотруднику")
    elif target.employee_id:
        raise HTTPException(422, "Сотрудника можно указать только при передаче сотруднику")
    return branch, department, employee


def move(record, target, validated):
    branch, department, employee = validated
    record.holder_type = target.holder_type
    record.employee = employee
    record.contractor = None
    record.item.branch = branch
    record.item.department = department


def validate_date(record, operation_date):
    if operation_date < record.last_operation_date:
        conflict("Дата раньше последней операции с картриджем")
    check_date(operation_date)


def check_date(value):
    if value > tracking_today():
        raise HTTPException(422, "Дата операции не может быть в будущем")


def snapshot(record):
    return {"location": location(record), "state": record.state,
            "device_id": record.device_id, "device_name": (
                f"{record.device.manufacturer} {record.device.model}" if record.device else None),
            "slot": record.slot, "contractor": record.contractor}


def log(db, record, operation, operation_date, actor, batch, before=None, notes=None,
        page_counter=None, pages_printed=None):
    before = before or {}
    record.last_operation_date = operation_date
    # Touch the version even for a same-day transfer; SQLAlchemy checks it at flush.
    record.version += 1
    record.item.condition = STATES[record.state]
    record.item.placement = location(record)[:100]
    record.operations.append(CartridgeOperation(
        batch_id=batch, item_id=record.item_id, date=operation_date, operation=operation,
        from_location=before.get("location"), to_location=location(record),
        from_state=before.get("state"), to_state=record.state,
        device_id=record.device.id if record.device else before.get("device_id"),
        device_name=(f"{record.device.manufacturer} {record.device.model}" if record.device else before.get("device_name")),
        slot=record.slot or before.get("slot"), contractor=record.contractor or before.get("contractor"),
        actor=actor["username"], notes=notes, page_counter=page_counter, pages_printed=pages_printed,
        expected_return_date=record.expected_return_date if operation in {"send_refill", "refill_deadline"} else None,
    ))
    add_item_event(
        db, record.item, category="cartridge", event_type=f"cartridge_{operation}",
        title=OPERATIONS[operation], actor=actor["username"], effective_date=operation_date,
        employee=record.employee, from_value=before.get("location"), to_value=location(record),
        details=f"{STATES.get(before.get('state'), '—')} → {STATES[record.state]}"
        + (f". Счётчик: {page_counter}" if page_counter is not None else "")
        + (f". Напечатано: {pages_printed}" if pages_printed is not None else "")
        + (f". Срок возврата: {record.expected_return_date or 'не задан'}" if operation in {"send_refill", "refill_deadline"} else "")
        + (f". {notes}" if notes else ""),
    )


@contextmanager
def transaction_errors(db):
    try:
        yield
    except (IntegrityError, StaleDataError) as exc:
        db.rollback()
        raise HTTPException(409, "Данные изменились или место в принтере уже занято. Обновите страницу.") from exc


@router.get("")
def list_cartridges(db: Session = Depends(get_db), _: dict = AUTH):
    profiles = compatibility_catalog(db)
    return [read(record, profiles) for record in query(db).order_by(Cartridge.item_id.desc()).all()]


@router.get("/compatibility")
def list_compatibility(db: Session = Depends(get_db), _: dict = AUTH):
    groups = {}
    for row in db.query(CartridgeCompatibility).order_by(CartridgeCompatibility.cartridge_model, CartridgeCompatibility.id):
        groups.setdefault(row.cartridge_key, {"cartridge_model": row.cartridge_model, "devices": []})["devices"].append(
            {"manufacturer": row.manufacturer, "model": row.model})
    return list(groups.values())


@router.put("/compatibility")
def update_compatibility(payload: CompatibilityInput, db: Session = Depends(get_db), actor: dict = AUTH):
    keys = [device_key(row.manufacturer, row.model) for row in payload.devices]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "Модель принтера указана несколько раз")
    key = model_key(payload.cartridge_model)
    with inventory_number_lock, transaction_errors(db):
        db.query(CartridgeCompatibility).filter_by(cartridge_key=key).delete(synchronize_session=False)
        db.add_all([CartridgeCompatibility(cartridge_model=payload.cartridge_model, cartridge_key=key,
                    manufacturer=row.manufacturer, model=row.model, device_key=device_key(row.manufacturer, row.model))
                    for row in payload.devices])
        db.commit()
    return {"cartridge_model": payload.cartridge_model, "devices": [row.model_dump() for row in payload.devices]}


@router.post("", status_code=201)
def create_cartridges(payload: CartridgeCreate, db: Session = Depends(get_db), actor: dict = AUTH):
    check_date(payload.date)
    target = Destination(branch_id=payload.branch_id, department_id=payload.department_id)
    validated = destination(db, target)
    try:
        numbers = [require_inventory_number(number) for number in payload.inventory_numbers]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if len(set(numbers)) != len(numbers):
        raise HTTPException(422, "Номера наклеек должны быть разными")
    with inventory_number_lock, transaction_errors(db):
        source = db.get(WarehouseItem, payload.source_item_id) if payload.source_item_id else None
        if payload.source_item_id:
            if not source or source.category != "Картриджи" or source.is_archived or db.get(Cartridge, source.id):
                conflict("Выберите неархивную складскую позицию картриджей без поштучного учёта оборота")
            if (source.branch_id, source.department_id) != (payload.branch_id, payload.department_id):
                conflict("Начальное местонахождение должно совпадать с исходной складской позицией")
            if source.tracking_type == "asset":
                if len(numbers) != 1 or source.inventory_number != numbers[0]:
                    conflict("Для существующей единицы укажите её текущий инвентарный номер")
                if db.query(WorkplaceAssetAssignment.id).filter_by(item_id=source.id, ended_at=None).first():
                    conflict("Сначала снимите картридж с рабочего места")
            elif _current_quantity(db, source.id) < len(numbers):
                conflict("Недостаточно картриджей в исходном остатке")
        for number in numbers:
            if inventory_number_owner(db, number, exclude_item_id=source.id if source and source.tracking_type == "asset" else None):
                conflict(f"Инвентарный номер {number} уже занят")
        batch = str(uuid4())
        records = []
        for number in numbers:
            item = source if source and source.tracking_type == "asset" else WarehouseItem(
                name=payload.name, category="Картриджи", tracking_type="asset", inventory_number=number,
                compatible_printers=payload.compatible_printers, unit="шт.", min_quantity=0,
                notes=payload.notes, placement="Склад/серверная", condition=STATES[payload.state],
            )
            db.add(item)
            db.flush()
            record = Cartridge(item=item, item_id=item.id, state=payload.state,
                               last_operation_date=payload.date, version=1, refill_count=0)
            move(record, target, validated)
            db.add(record)
            db.flush()
            if item is not source:
                db.add(StockMovement(item_id=item.id, date=payload.date, movement_type=StockMovementType.receipt,
                                     quantity=1, notes="Поштучный учёт картриджа"))
            log(db, record, "registered" if source else "received", payload.date, actor, batch, notes=payload.notes)
            records.append(record)
        if source and source.tracking_type == "quantity":
            db.add(StockMovement(item_id=source.id, date=payload.date, movement_type=StockMovementType.issue,
                                 quantity=len(records), cartridge_conversion=True,
                                 notes="Переведено в поштучный учёт: " + ", ".join(numbers)))
            add_item_event(db, source, category="stock", event_type="stock_issued",
                           title="Картриджи переведены в поштучный учёт", actor=actor["username"],
                           effective_date=payload.date, details=", ".join(numbers))
        db.commit()
        profiles = compatibility_catalog(db)
        return [read(record, profiles) for record in records]


@router.get("/operations")
def operations(item_id: int | None = None, device_id: int | None = None,
               db: Session = Depends(get_db), _: dict = AUTH):
    q = db.query(CartridgeOperation, WarehouseItem.inventory_number, WarehouseItem.name).join(
        WarehouseItem, WarehouseItem.id == CartridgeOperation.item_id)
    if item_id is not None:
        q = q.filter(CartridgeOperation.item_id == item_id)
    if device_id is not None:
        q = q.filter(CartridgeOperation.device_id == device_id)
    return [{**{column.name: getattr(row, column.name) for column in CartridgeOperation.__table__.columns},
             "inventory_number": number, "name": name}
            for row, number, name in q.order_by(CartridgeOperation.date.desc(), CartridgeOperation.id.desc()).all()]


@router.post("/actions")
def action(payload: CartridgeAction, db: Session = Depends(get_db), actor: dict = AUTH):
    with inventory_number_lock, transaction_errors(db):
        records = [get_cartridge(db, item_id) for item_id in payload.item_ids]
        op = payload.operation
        validated = destination(db, payload.destination) if op in {"transfer", "return_refill", "remove"} else None
        if op == "send_refill" and not payload.contractor:
            raise HTTPException(422, "Укажите подрядчика по заправке")
        for record in records:
            validate_date(record, payload.date)
            if record.state == "written_off" or record.item.is_archived:
                conflict("Списанный или архивный картридж недоступен для операций")
            if op == "transfer" and record.state not in {"ready", "empty", "defective"}:
                conflict("Передавать можно только снятые картриджи, не находящиеся на заправке")
            if op == "send_refill" and record.state != "empty":
                conflict("На заправку можно отправить только пустой картридж")
            if op == "return_refill" and record.state != "refilling":
                conflict("Картридж не находится на заправке")
            if op == "refill_deadline":
                if record.state != "refilling":
                    conflict("Изменить срок можно только у картриджа на заправке")
                if payload.expected_return_date and record.last_refill_sent_at and payload.expected_return_date < record.last_refill_sent_at:
                    raise HTTPException(422, "Срок возврата не может быть раньше отправки")
            if op == "remove" and record.state != "installed":
                conflict("Картридж не установлен в принтере")
            if op == "remove":
                cycle_pages(record, payload.page_counters.get(record.item_id))
            if op in {"defective", "write_off"} and record.state in {"installed", "refilling"}:
                conflict("Сначала снимите картридж или оформите возврат с заправки")
        batch = str(uuid4())
        for record in records:
            before = snapshot(record)
            counter = payload.page_counters.get(record.item_id) if op == "remove" else None
            printed = cycle_pages(record, counter) if op == "remove" else None
            if validated:
                move(record, payload.destination, validated)
            if op == "send_refill":
                record.state = "refilling"
                record.holder_type = "contractor"
                record.employee = None
                record.contractor = payload.contractor
                record.last_refill_sent_at = payload.date
                record.expected_return_date = payload.expected_return_date
            elif op == "refill_deadline":
                record.expected_return_date = payload.expected_return_date
            elif op == "return_refill":
                record.state = payload.result
                record.last_refill_returned_at = payload.date
                record.expected_return_date = None
                if payload.result == "ready":
                    record.refill_count += 1
            elif op == "remove":
                record.state = "empty"
                record.device = None
                record.slot = None
                record.last_removed_at = payload.date
                record.installation_page_counter = None
            elif op in {"defective", "write_off"}:
                record.state = "defective" if op == "defective" else "written_off"
                if op == "write_off":
                    record.item.is_archived = True
                    record.item.archived_at = datetime.now(timezone.utc)
            log(db, record, op, payload.date, actor, batch, before, payload.notes,
                page_counter=counter, pages_printed=printed)
        db.commit()
        profiles = compatibility_catalog(db)
        return [read(record, profiles) for record in records]


@router.post("/install")
def install(payload: CartridgeInstall, db: Session = Depends(get_db), actor: dict = AUTH):
    with inventory_number_lock, transaction_errors(db):
        incoming = get_cartridge(db, payload.item_id)
        validate_date(incoming, payload.date)
        if incoming.state != "ready" or incoming.item.is_archived:
            conflict("Установить можно только готовый неархивный картридж")
        device = db.get(Device, payload.device_id)
        if not device or device.device_type == DeviceType.scanner or device.status == DeviceStatus.decommissioned:
            raise HTTPException(422, "Выберите действующий принтер, МФУ или плоттер")
        profiles = compatibility_catalog(db)
        compatible = profiles.get(model_key(incoming.item.name), [])
        if compatible and device_key(device.manufacturer, device.model) not in {
            device_key(row["manufacturer"], row["model"]) for row in compatible
        }:
            raise HTTPException(422, "Модель картриджа несовместима с выбранной моделью принтера по справочнику")
        if not device.department or not device.department.branch_id:
            raise HTTPException(422, "Сначала укажите филиал и отдел у принтера")
        target = payload.destination
        validated = destination(db, target)
        if target.holder_type == "warehouse" or (target.branch_id, target.department_id) != (
            device.department.branch_id, device.department_id,
        ):
            raise HTTPException(422, "Получатель должен быть сотрудником или отделом по местонахождению принтера")
        outgoing = query(db).filter(Cartridge.device_id == device.id, Cartridge.slot == payload.slot).first()
        if (outgoing.item_id if outgoing else None) != payload.removed_item_id:
            conflict("Установленный картридж изменился. Выберите снимаемый картридж и повторите замену")
        batch = str(uuid4())
        if outgoing:
            validate_date(outgoing, payload.date)
            printed = cycle_pages(outgoing, payload.page_counter)
            before = snapshot(outgoing)
            outgoing.state = "empty"
            outgoing.device = None
            outgoing.slot = None
            outgoing.last_removed_at = payload.date
            outgoing.installation_page_counter = None
            log(db, outgoing, "remove", payload.date, actor, batch, before, payload.notes,
                page_counter=payload.page_counter, pages_printed=printed)
            # Release the unique device slot before assigning its replacement.
            db.flush()
        before = snapshot(incoming)
        move(incoming, target, validated)
        incoming.device = device
        incoming.slot = payload.slot
        incoming.state = "installed"
        incoming.last_installed_at = payload.date
        incoming.installation_page_counter = payload.page_counter
        log(db, incoming, "install", payload.date, actor, batch, before, payload.notes, page_counter=payload.page_counter)
        db.commit()
        return read(incoming)


@router.get("/{item_id}")
def get_card(item_id: int, db: Session = Depends(get_db), _: dict = AUTH):
    return read(get_cartridge(db, item_id))


@router.delete("/{item_id}", status_code=204)
def delete_cartridge(item_id: int, version: int = Query(ge=1),
                     db: Session = Depends(get_db), actor: dict = AUTH):
    with inventory_number_lock, transaction_errors(db):
        record = get_cartridge(db, item_id)
        if record.version != version:
            conflict("Карточка изменилась. Обновите список перед удалением.")
        before = snapshot(record)
        operation_date = tracking_today()
        # Keep immutable history and inventory identity, while releasing live links.
        # This follows the warehouse's archival deletion and prevents stock doubling.
        record.operations.append(CartridgeOperation(
            batch_id=str(uuid4()), item_id=item_id, date=operation_date,
            operation="deleted", from_location=before["location"], to_location="Удалено из учёта",
            from_state=record.state, to_state=record.state,
            device_id=record.device_id, device_name=before["device_name"],
            slot=record.slot, contractor=record.contractor, actor=actor["username"],
        ))
        add_item_event(db, record.item, category="cartridge", event_type="cartridge_deleted",
                       title="Карточка картриджа удалена", actor=actor["username"],
                       effective_date=operation_date, employee=record.employee,
                       from_value=before["location"], to_value="Удалено из учёта",
                       details="История, номер наклейки и складской архив сохранены")
        record.is_deleted = True
        record.last_operation_date = operation_date
        record.device = None
        record.slot = None
        record.employee = None
        record.contractor = None
        record.holder_type = "warehouse"
        record.expected_return_date = None
        record.installation_page_counter = None
        record.item.is_archived = True
        record.item.archived_at = datetime.now(timezone.utc)
        record.item.condition = "Удалено из учёта"
        record.item.placement = "Архив"
        db.commit()
