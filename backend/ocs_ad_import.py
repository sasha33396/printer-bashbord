"""Apply normalized OCS inventories enriched by an AD collector.

The collector does not decide which application entities to create or move.
All matching, conflict checks and writes are performed in this module.
"""

import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError

from equipment_history import add_item_event, changed_values
from inventory_numbers import inventory_number_lock
from models import (
    Employee, OcsAssetLink, OcsImportRun, StockMovement, StockMovementType,
    WarehouseItem, Workplace, WorkplaceAssetAssignment, WorkplaceStatus,
)
from import_schemas import OcsAdImportResponse, OcsImportRecordResult
from routers.employees import _validate_location, validate_ad_identity
from routers.workplaces import _new_assignment


COMPUTER_CATEGORIES = ("Компьютеры", "Ноутбуки")
DEFAULT_LAPTOP_NAMES = (
    "NOTEBOOK-RTI", "NOTEBOOK-CHPU-DISP", "LAPTOP-COM", "NOTE-PROXIMA-1",
    "NOTE-BUH-2", "NOTE-HR-1", "UP-OP-NOTES1", "NOTE-WED-1",
    "NOTEBOOK-SAR1", "ERSHOV-NOTE",
)


def _computer_category(data, name):
    if data.form_factor:
        return "Ноутбуки" if data.form_factor == "laptop" else "Компьютеры"
    known_names = {
        value.strip().upper() for value in os.getenv(
            "OCS_AD_LAPTOP_NAMES", ",".join(DEFAULT_LAPTOP_NAMES),
        ).split(",") if value.strip()
    }
    return "Ноутбуки" if name in known_names else None


class ImportConflict(ValueError):
    pass


class ImportSkip(ValueError):
    pass


def _utc(value):
    # SQLite returns naive datetimes even for DateTime(timezone=True).
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _values(text):
    return json.loads(text) if text else {}


def _serial(value):
    value = value.strip() if value else None
    if not value or value.lower() in {
        "default string", "unknown", "none", "n/a", "not specified",
        "system serial number", "to be filled by o.e.m.",
    }:
        return None
    if not value.replace("0", "").replace("-", "").replace(" ", ""):
        return None
    return value


def _sync(entity, incoming, previous, result, label):
    """Update source-managed values; retain edits made since the last import."""
    accepted = dict(previous)
    before = {}
    after = {}
    for field, value in incoming.items():
        if value is None or value == "":
            continue
        current = getattr(entity, field)
        if current == value:
            accepted[field] = value
            continue
        if current not in (None, "") and (field not in previous or current != previous[field]):
            result.warnings.append(f"{label}: сохранено ручное значение поля {field}")
            continue
        before[field] = current
        after[field] = value
        setattr(entity, field, value)
        accepted[field] = value
    return accepted, changed_values(before, after)


def _employee(db, record, result):
    login_matches = db.query(Employee).filter(
        func.lower(func.trim(Employee.ad_login)) == record.ad_login,
        or_(
            func.coalesce(func.lower(func.trim(Employee.ad_domain)), "") == record.domain,
            Employee.ad_domain.is_(None),
        ),
    ).all()
    if len(login_matches) > 1:
        raise ImportConflict("Логину AD соответствуют несколько сотрудников")
    employee = login_matches[0] if login_matches else None
    by_guid = db.query(Employee).filter(func.lower(Employee.ad_guid) == record.ad_guid).first() if record.ad_guid else None
    if employee and by_guid and employee.id != by_guid.id:
        raise ImportConflict("Логин и GUID AD относятся к разным сотрудникам")
    employee = employee or by_guid
    if record.employee_id:
        explicit = db.get(Employee, record.employee_id)
        if not explicit or (employee and employee.id != explicit.id):
            raise ImportConflict("Указанная карточка сотрудника не соответствует данным AD")
        if explicit.ad_login and explicit.ad_login != record.ad_login and not by_guid:
            raise ImportConflict("У указанного сотрудника уже задан другой логин AD")
        employee = explicit
    if employee and not employee.is_active:
        raise ImportConflict("Сотрудник в приложении неактивен")
    if employee and employee.ad_guid and record.ad_guid and employee.ad_guid != record.ad_guid:
        raise ImportConflict("Логин совпал, но GUID AD изменился; требуется проверка сотрудника")
    if employee and employee.ad_domain and employee.ad_domain != record.domain and not by_guid:
        raise ImportConflict("Сотрудник относится к другому домену AD")

    fields = {"full_name": record.full_name, "position": record.position, "email": record.email, "phone": record.phone}
    if employee is None:
        # Do not silently duplicate a manually entered employee without an AD login.
        candidates = [candidate for candidate in db.query(Employee).filter(Employee.ad_login.is_(None)).all() if (
            candidate.full_name.strip().casefold() == record.full_name.casefold()
            or (record.email and candidate.email and candidate.email.casefold() == record.email.casefold())
        )]
        if candidates:
            ids = ", ".join(str(candidate.id) for candidate in candidates)
            raise ImportConflict(f"Найдены сотрудники без логина AD (ID: {ids}); задайте employee_id или заполните логин")
        employee = Employee(full_name=record.full_name, branch_id=record.branch_id, department_id=record.department_id)
        db.add(employee)
        result.actions.append("employees_created")
    identity_changed = (employee.ad_login, employee.ad_domain, employee.ad_guid) != (
        record.ad_login, record.domain, record.ad_guid or employee.ad_guid,
    )
    validate_ad_identity(db, record.ad_login, record.domain, record.ad_guid, employee.id)
    employee.ad_login = record.ad_login
    employee.ad_domain = record.domain
    employee.ad_guid = record.ad_guid or employee.ad_guid
    accepted, changes = _sync(employee, fields, _values(employee.ad_sync_values), result, "Сотрудник")
    employee.ad_sync_values = json.dumps(accepted, ensure_ascii=False)
    if "employees_created" not in result.actions and (changes or identity_changed):
        result.actions.append("employees_updated")
    db.flush()
    result.employee_id = employee.id
    return employee


def _asset(db, request, record, data, kind, external_id, name, result, actor, today):
    expected_category = _computer_category(data, name) if kind == "computer" else "Мониторы"
    category = expected_category or "Компьютеры"
    categories = COMPUTER_CATEGORIES if kind == "computer" else ("Мониторы",)
    link = db.query(OcsAssetLink).filter_by(
        source_key=request.source_key, asset_kind=kind, external_id=external_id,
    ).first()
    item = db.get(WarehouseItem, link.item_id) if link else None
    serial = _serial(data.serial_number)
    if data.item_id:
        explicit = db.get(WarehouseItem, data.item_id)
        if not explicit or (item and item.id != explicit.id):
            raise ImportConflict(f"{category}: указанная карточка не соответствует связи OCS")
        item = explicit
    if kind == "computer" and data.match_existing_name:
        if data.match_existing_name.casefold() != name.casefold():
            raise ImportConflict("Имя для сопоставления отличается от имени компьютера OCS")
        # This is an explicit operator decision, never an automatic name match.
        # A saved source link remains authoritative after manual card renaming.
        if link is None:
            matches = [candidate for candidate in db.query(WarehouseItem).filter(
                WarehouseItem.category.in_(categories),
            ).all() if candidate.name.strip().casefold() == data.match_existing_name.casefold()]
            if len(matches) != 1:
                raise ImportConflict("Явное сопоставление по имени требует ровно одну существующую карточку")
            if item and item.id != matches[0].id:
                raise ImportConflict("item_id и имя для сопоставления относятся к разным карточкам")
            item = matches[0]
    if item and serial and _serial(item.serial_number) and item.serial_number.lower() != serial.lower():
        raise ImportConflict(f"{category}: серийный номер связанной карточки отличается от OCS")
    if item is None and serial:
        matches = db.query(WarehouseItem).filter(
            WarehouseItem.category.in_(categories),
            WarehouseItem.tracking_type == "asset",
            func.lower(func.trim(WarehouseItem.serial_number)) == serial.lower(),
        ).all()
        if len(matches) > 1:
            raise ImportConflict(f"{category}: серийный номер соответствует нескольким карточкам")
        item = matches[0] if matches else None
    if item and (item.is_archived or item.tracking_type != "asset" or item.category not in categories):
        raise ImportConflict(f"{category}: карточка архивная или имеет другой тип оборудования")
    if item and expected_category and item.category != expected_category:
        raise ImportConflict(
            f"OCS: ожидается категория «{expected_category}», но карточка ID {item.id} "
            f"находится в «{item.category}»; проверьте тип оборудования и категорию карточки"
        )
    if item:
        category = item.category
    if item is None and kind == "monitor" and serial is None:
        result.warnings.append(f"Монитор {name} (OCS ID {external_id}) пропущен: нет достоверного серийного номера; можно указать item_id")
        return None, None
    if item is None and kind == "computer":
        candidates = db.query(WarehouseItem).filter(
            WarehouseItem.category.in_(categories),
            func.upper(func.trim(WarehouseItem.name)) == name,
        ).all()
        if candidates:
            raise ImportConflict("Найден компьютер с таким именем без подтверждённой связи; укажите computer.item_id")

    fields = data.model_dump(exclude={"item_id", "ocs_id", "name", "form_factor", "match_existing_name"})
    fields.update(name=name, serial_number=serial)
    created = item is None
    if created:
        item = WarehouseItem(
            name=name, category=category, tracking_type="asset",
            inventory_number=None,
            branch_id=record.branch_id, department_id=record.department_id,
            placement="Не определено", condition="Рабочий", unit="шт.", min_quantity=0,
        )
        db.add(item)
        db.flush()
        db.add(StockMovement(item_id=item.id, date=today, movement_type=StockMovementType.receipt, quantity=1, notes="Импорт OCS"))
        result.actions.append("computers_created" if kind == "computer" else "monitors_created")
    if link is None:
        link = OcsAssetLink(source_key=request.source_key, asset_kind=kind, external_id=external_id, item_id=item.id)
        db.add(link)
        result.actions.append("source_linked")
    if link.last_inventory_at and _utc(record.last_inventory_at) < _utc(link.last_inventory_at):
        raise ImportSkip("Инвентаризация старее уже обработанной записи OCS")
    accepted, changes = _sync(item, fields, _values(link.sync_values), result, category)
    link.sync_values = json.dumps(accepted, ensure_ascii=False)
    link.last_inventory_at = _utc(record.last_inventory_at)
    if created or changes:
        if not created:
            result.actions.append("computers_updated" if kind == "computer" else "monitors_updated")
        add_item_event(
            db, item, category="equipment", event_type="created" if created else "updated",
            title="Оборудование импортировано из OCS" if created else "Обновлены сведения OCS",
            actor=actor, effective_date=today, details=f"OCS: {request.source_key}, {kind} ID {external_id}",
            changes=changes,
        )
    db.flush()
    return item, link


def _workplace(db, record, employee, computer, link, result, require_existing=False):
    assignment = db.query(WorkplaceAssetAssignment).filter_by(item_id=computer.id, ended_at=None).first()
    workplace = db.get(Workplace, link.workplace_id) if link.workplace_id else None
    if assignment:
        if workplace and workplace.id != assignment.workplace_id:
            raise ImportConflict("Компьютер перемещён на другое рабочее место")
        workplace = db.get(Workplace, assignment.workplace_id)
    if workplace is None:
        owned = db.query(Workplace).filter_by(employee_id=employee.id).all()
        if len(owned) > 1:
            raise ImportConflict("У сотрудника несколько рабочих мест; требуется выбрать основное вручную")
        if owned:
            main = owned[0]
            other_desktop = db.query(WorkplaceAssetAssignment.id).join(
                WarehouseItem, WarehouseItem.id == WorkplaceAssetAssignment.item_id,
            ).filter(
                WorkplaceAssetAssignment.workplace_id == main.id,
                WorkplaceAssetAssignment.ended_at.is_(None),
                WarehouseItem.category == COMPUTER_CATEGORIES[0],
                WarehouseItem.id != computer.id,
            ).first()
            if computer.category == COMPUTER_CATEGORIES[1] or not other_desktop:
                workplace = main
    if workplace is None:
        candidates = db.query(Workplace).filter(Workplace.normalized_name == record.computer_name.casefold()).all()
        if len(candidates) > 1:
            raise ImportConflict("Имени компьютера соответствуют несколько рабочих мест")
        workplace = candidates[0] if candidates else None
    if workplace and (workplace.is_archived or workplace.status == WorkplaceStatus.inactive):
        raise ImportConflict("Рабочее место архивное или неактивное")
    if workplace and workplace.employee_id not in (None, employee.id):
        raise ImportConflict("Рабочее место закреплено за другим сотрудником")
    other = db.query(Workplace).filter(Workplace.employee_id == employee.id)
    if workplace:
        other = other.filter(Workplace.id != workplace.id)
    if other.first():
        raise ImportConflict("Сотрудник уже закреплён за другим рабочим местом")
    if workplace is None:
        if require_existing:
            raise ImportConflict("Для дополнительного ноутбука не найдено основное рабочее место; проверьте импорт основного ПК")
        workplace = Workplace(
            name=record.computer_name, employee_id=employee.id,
            branch_id=record.branch_id, department_id=record.department_id,
            status=WorkplaceStatus.occupied,
        )
        db.add(workplace)
        result.actions.append("workplaces_created")
    elif workplace.employee_id is None:
        # Existing assignment snapshots must not silently change their owner.
        if db.query(WorkplaceAssetAssignment.id).filter_by(workplace_id=workplace.id, ended_at=None).first():
            raise ImportConflict("На рабочем месте уже есть оборудование без сотрудника; назначение требует проверки")
        workplace.employee_id = employee.id
        workplace.status = WorkplaceStatus.occupied
        result.actions.append("workplace_employee_assigned")
    for entity in (employee, computer):
        if workplace.branch_id and entity.branch_id and workplace.branch_id != entity.branch_id:
            raise ImportConflict("Филиалы сотрудника, компьютера и рабочего места не совпадают")
        if workplace.department_id and entity.department_id and workplace.department_id != entity.department_id:
            raise ImportConflict("Отделы сотрудника, компьютера и рабочего места не совпадают")
    db.flush()
    link.workplace_id = workplace.id
    result.workplace_id = workplace.id
    return workplace


def _assign(db, workplace, item, result, actor, today):
    assignment = db.query(WorkplaceAssetAssignment).filter_by(item_id=item.id, ended_at=None).first()
    if assignment:
        if assignment.workplace_id != workplace.id:
            raise ImportConflict(f"Оборудование ID {item.id} уже закреплено за другим рабочим местом")
        if assignment.employee_id not in (None, workplace.employee_id):
            raise ImportConflict("Ответственный в истории закрепления отличается от сотрудника рабочего места")
        return
    if item.branch_id and workplace.branch_id and item.branch_id != workplace.branch_id:
        raise ImportConflict("Оборудование находится в другом филиале")
    if item.department_id and workplace.department_id and item.department_id != workplace.department_id:
        raise ImportConflict("Оборудование находится в другом отделе")
    if workplace.branch_id is not None:
        item.branch_id = workplace.branch_id
        item.department_id = workplace.department_id
    item.placement = "Рабочее место"
    db.add(_new_assignment(workplace, item, today, "Импорт OCS + AD"))
    add_item_event(
        db, item, workplace=workplace, employee=workplace.employee,
        category="workplace", event_type="assigned_to_workplace",
        title="Оборудование закреплено при импорте OCS", actor=actor,
        effective_date=today, to_value=workplace.name,
    )
    result.actions.append("assets_assigned")
    db.flush()


def _batch_duplicates(records):
    keys = []
    for record in records:
        values = [("computer", record.ocs_id), ("name", record.computer_name)]
        if _serial(record.computer.serial_number):
            values.append(("computer_serial", _serial(record.computer.serial_number).lower()))
        for monitor in record.monitors:
            values.append(("monitor", monitor.ocs_id))
            if _serial(monitor.serial_number):
                values.append(("monitor_serial", _serial(monitor.serial_number).lower()))
        keys.append(values)
    counts = Counter(key for values in keys for key in values)
    blocked = {index for index, values in enumerate(keys) if any(counts[key] > 1 for key in values)}
    groups = {}
    guids = {}
    for index, record in enumerate(records):
        identity = (record.domain, record.ad_login)
        if record.ad_login:
            groups.setdefault(identity, []).append(index)
        if record.ad_guid:
            guids.setdefault(record.ad_guid, []).append(index)
    for indexes in groups.values():
        desktops = [i for i in indexes if not _is_laptop(records[i])]
        ids = {records[i].ad_guid for i in indexes if records[i].ad_guid}
        if len(desktops) > 1 or len(ids) > 1:
            blocked.update(indexes)
    for indexes in guids.values():
        if len({(records[i].domain, records[i].ad_login) for i in indexes}) > 1:
            blocked.update(indexes)
    return blocked


def _is_laptop(record):
    return _computer_category(record.computer, record.computer_name) == COMPUTER_CATEGORIES[1]


def import_ocs_ad(db, request, actor):
    response = OcsAdImportResponse(dry_run=request.dry_run, processed=len(request.records))
    duplicates = _batch_duplicates(request.records)
    identity_counts = Counter((record.domain, record.ad_login) for record in request.records)
    now = datetime.now(timezone.utc)
    today = now.date()
    excluded = {value.strip().lower() for value in os.getenv("OCS_AD_EXCLUDED_LOGINS", "administrator,admin").split(",")}
    # Use the existing inventory lock for both dry-run and apply. SQLite must have
    # a real outer BEGIN before SAVEPOINTs, otherwise RELEASE can commit previews.
    with inventory_number_lock:
        transaction = db.begin()
        try:
            if db.get_bind().dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN")
            # Import primary PCs before their laptops, including in previews.
            for index, record in sorted(enumerate(request.records), key=lambda row: _is_laptop(row[1])):
                result = OcsImportRecordResult(index=index, ocs_id=record.ocs_id, computer_name=record.computer_name, status="unchanged")
                try:
                    if index in duplicates:
                        raise ImportConflict("Повторные идентификаторы оборудования или неоднозначные основные ПК/данные AD; требуется ручная проверка")
                    if not record.ad_login or not record.domain or not record.full_name or record.ad_enabled is None:
                        raise ImportSkip("Нет подтверждённых данных пользователя AD: нужны логин, домен, имя и ad_enabled")
                    if record.ad_login in excluded:
                        raise ImportSkip("Служебная учётная запись исключена из импорта")
                    if not record.ad_enabled:
                        raise ImportSkip("Учётная запись отключена в AD")
                    if _utc(record.last_inventory_at) < now - timedelta(days=request.max_age_days):
                        raise ImportSkip("Инвентаризация OCS устарела")
                    if _utc(record.last_inventory_at) > now + timedelta(minutes=5):
                        raise ImportSkip("Дата инвентаризации OCS находится в будущем")
                    with db.begin_nested():
                        _validate_location(db, record.branch_id, record.department_id)
                        employee = _employee(db, record, result)
                        computer, link = _asset(db, request, record, record.computer, "computer", record.ocs_id, record.computer_name, result, actor, today)
                        result.computer_item_id = computer.id
                        result.computer_category = computer.category
                        workplace = _workplace(
                            db, record, employee, computer, link, result,
                            require_existing=_is_laptop(record) and identity_counts[(record.domain, record.ad_login)] > 1,
                        )
                        _assign(db, workplace, computer, result, actor, today)
                        for monitor in record.monitors:
                            item, monitor_link = _asset(db, request, record, monitor, "monitor", monitor.ocs_id, monitor.name, result, actor, today)
                            if item:
                                _assign(db, workplace, item, result, actor, today)
                                monitor_link.workplace_id = workplace.id
                                result.monitor_item_ids.append(item.id)
                        db.flush()
                    for action in result.actions:
                        if action in OcsAdImportResponse.model_fields:
                            setattr(response, action, getattr(response, action) + 1)
                    if any(action.endswith("_created") for action in result.actions):
                        result.status = "created"
                    elif result.actions:
                        result.status = "updated"
                except (ImportConflict, IntegrityError, HTTPException) as error:
                    result = OcsImportRecordResult(
                        index=index, ocs_id=record.ocs_id, computer_name=record.computer_name,
                        status="conflict", message=(
                            error.detail if isinstance(error, HTTPException)
                            else str(error) if isinstance(error, ImportConflict)
                            else "Конфликт уникальности данных; повторите проверку"
                        ),
                    )
                except ImportSkip as error:
                    result = OcsImportRecordResult(index=index, ocs_id=record.ocs_id, computer_name=record.computer_name, status="skipped", message=str(error))
                response.records.append(result)
                response.warnings += len(result.warnings)
                response.conflicts += result.status == "conflict"
                response.skipped += result.status == "skipped"
                response.unchanged += result.status == "unchanged"
            response.records.sort(key=lambda result: result.index)
            if request.dry_run:
                transaction.rollback()
            else:
                response.run_id = str(uuid4())
                db.add(OcsImportRun(id=response.run_id, source_key=request.source_key, actor=actor, report_json=response.model_dump_json()))
                transaction.commit()
        except Exception:
            if transaction.is_active:
                transaction.rollback()
            raise
    return response
