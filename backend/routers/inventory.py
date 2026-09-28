from __future__ import annotations

import json
import os
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload
from starlette.background import BackgroundTask

from database import get_db
from inventory_numbers import inventory_number_lock, inventory_number_owner, require_inventory_number
from models import (
    Branch, ConsumableLog, Department, Device, DeviceStatus, DeviceType,
    ItemType, Manufacturer, RepairRecord, RepairStatus, RepairType, StockMovement,
    StockMovementType, WarehouseItem, WorkplaceAssetAssignment,
)
from photo_storage import (
    IMAGE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ITEM, image_extension,
    normalize_photo_filenames, photo_directory, photo_files,
)
from routers.auth import get_current_user


router = APIRouter()
_auth = Depends(get_current_user)

ARCHIVE_VERSION = 1
JSON_MARKER = "--- ДАННЫЕ ДЛЯ ИМПОРТА (JSON) ---"
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 20000


def _date_value(value):
    return value.isoformat() if value else None


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


def _device_card(device: Device) -> dict:
    return {
        "archive_version": ARCHIVE_VERSION,
        "entity_type": "device",
        "inventory_number": device.inventory_number,
        "data": {
            "ip_address": device.ip_address,
            "page_counter": device.page_counter,
            "counter_checked_at": device.counter_checked_at,
            "serial_number": device.serial_number,
            "manufacturer": device.manufacturer,
            "model": device.model,
            "device_type": _enum_value(device.device_type),
            "branch": device.department.branch.name if device.department and device.department.branch else None,
            "branch_address": device.department.branch.address if device.department and device.department.branch else None,
            "department": device.department.name if device.department else None,
            "location": device.location,
            "purchase_date": _date_value(device.purchase_date),
            "warranty_until": _date_value(device.warranty_until),
            "status": _enum_value(device.status),
            "notes": device.notes,
            "repairs": [
                {
                    "date": _date_value(record.date),
                    "repair_type": _enum_value(record.repair_type),
                    "repair_status": _enum_value(record.repair_status),
                    "description": record.description,
                    "contractor": record.contractor,
                    "cost": record.cost,
                    "page_counter": record.page_counter,
                    "completion_page_counter": record.completion_page_counter,
                    "page_counter_delta": record.page_counter_delta,
                    "notes": record.notes,
                }
                for record in device.repair_records
            ],
            "consumables": [
                {
                    "date": _date_value(record.date),
                    "item_type": _enum_value(record.item_type),
                    "quantity": record.quantity,
                    "unit_cost": record.unit_cost,
                    "page_counter": record.page_counter,
                    "notes": record.notes,
                }
                for record in device.consumable_logs
            ],
        },
    }


def _warehouse_card(item: WarehouseItem, db: Session) -> dict:
    assignment = (
        db.query(WorkplaceAssetAssignment)
        .options(joinedload(WorkplaceAssetAssignment.workplace))
        .filter(
            WorkplaceAssetAssignment.item_id == item.id,
            WorkplaceAssetAssignment.ended_at.is_(None),
        )
        .first()
    )
    quantity = int((
        db.query(func.coalesce(func.sum(case(
            (StockMovement.movement_type == StockMovementType.receipt, StockMovement.quantity),
            else_=-StockMovement.quantity,
        )), 0))
        .filter(StockMovement.item_id == item.id)
        .scalar()
    ) or 0)
    return {
        "archive_version": ARCHIVE_VERSION,
        "entity_type": "warehouse_item",
        "inventory_number": item.inventory_number,
        "data": {
            "article": item.sku,
            "name": item.name,
            "category": item.category,
            "branch": item.branch.name if item.branch else None,
            "branch_address": item.branch.address if item.branch else None,
            "department": item.department.name if item.department else None,
            "tracking_type": item.tracking_type,
            "serial_number": item.serial_number,
            "manufacturer": item.manufacturer,
            "model": item.model,
            "placement": item.placement,
            "condition": item.condition,
            "compatible_printers": item.compatible_printers,
            "monitor_diagonal": item.monitor_diagonal,
            "color": item.color,
            "ram_gb": item.ram_gb,
            "processor": item.processor,
            "graphics": item.graphics,
            "storage_type": item.storage_type,
            "storage_capacity_gb": item.storage_capacity_gb,
            "unit": item.unit,
            "min_quantity": item.min_quantity,
            "current_quantity": quantity,
            "notes": item.notes,
            "workplace": assignment.workplace.name if assignment else None,
            "movements": [
                {
                    "date": _date_value(record.date),
                    "movement_type": _enum_value(record.movement_type),
                    "quantity": record.quantity,
                    "notes": record.notes,
                }
                for record in item.movements
            ],
        },
    }


def _card_text(card: dict) -> str:
    data = card["data"]
    entity_label = "Устройство" if card["entity_type"] == "device" else "Складское оборудование"
    title = data.get("name") or " ".join(filter(None, [data.get("manufacturer"), data.get("model")]))
    lines = [
        "Карточка Printer Dashboard",
        f"Тип: {entity_label}",
        f"Инвентарный номер: {card['inventory_number']}",
        f"Наименование: {title or '—'}",
        f"Серийный номер: {data.get('serial_number') or '—'}",
        f"Филиал: {data.get('branch') or '—'}",
        f"Отдел: {data.get('department') or '—'}",
        f"Местонахождение: {data.get('placement') or data.get('location') or '—'}",
        "",
        JSON_MARKER,
        json.dumps(card, ensure_ascii=False, indent=2),
        "",
    ]
    return "\n".join(lines)


def _remove_file(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


@router.get("/archive")
def export_inventory_archive(db: Session = Depends(get_db), _: dict = _auth):
    devices = (
        db.query(Device)
        .options(
            joinedload(Device.department).joinedload(Department.branch),
            joinedload(Device.repair_records),
            joinedload(Device.consumable_logs),
        )
        .order_by(Device.inventory_number)
        .all()
    )
    items = (
        db.query(WarehouseItem)
        .options(
            joinedload(WarehouseItem.branch),
            joinedload(WarehouseItem.department),
            joinedload(WarehouseItem.movements),
        )
        .filter(WarehouseItem.inventory_number.isnot(None))
        .order_by(WarehouseItem.inventory_number)
        .all()
    )

    temp = tempfile.NamedTemporaryFile(prefix="inventory-", suffix=".zip", delete=False)
    temp_path = temp.name
    temp.close()
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for device in devices:
                card = _device_card(device)
                archive.writestr(
                    f"{device.inventory_number}/{device.inventory_number}.txt",
                    _card_text(card).encode("utf-8"),
                )
            for item in items:
                card = _warehouse_card(item, db)
                archive.writestr(
                    f"{item.inventory_number}/{item.inventory_number}.txt",
                    _card_text(card).encode("utf-8"),
                )
                if item.tracking_type == "asset":
                    normalize_photo_filenames(item.inventory_number)
                    for photo in photo_files(item.inventory_number):
                        archive.write(photo, arcname=f"{item.inventory_number}/{photo.name}")
    except Exception:
        _remove_file(temp_path)
        raise

    filename = f"inventory_export_{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return FileResponse(
        temp_path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_remove_file, temp_path),
    )


def _parse_optional_date(value) -> Optional[date]:
    return date.fromisoformat(value) if value else None


def _organization(db: Session, data: dict) -> tuple[Optional[int], Optional[int]]:
    branch_name = (data.get("branch") or "").strip()
    department_name = (data.get("department") or "").strip()
    branch = None
    if branch_name:
        branch = db.query(Branch).filter(Branch.name == branch_name).first()
        if not branch:
            branch = Branch(name=branch_name, address=data.get("branch_address"))
            db.add(branch)
            db.flush()
    department = None
    if department_name:
        department = db.query(Department).filter(
            Department.name == department_name,
            Department.branch_id == (branch.id if branch else None),
        ).first()
        if not department:
            department = Department(name=department_name, branch_id=branch.id if branch else None)
            db.add(department)
            db.flush()
    return branch.id if branch else None, department.id if department else None


def _import_device(db: Session, inventory_number: str, data: dict) -> str:
    owner = inventory_number_owner(db, inventory_number)
    if owner and owner != "device":
        raise ValueError("инвентарный номер уже занят складским оборудованием")
    device = db.query(Device).filter(Device.inventory_number == inventory_number).first()
    is_new = device is None
    _, department_id = _organization(db, data)
    if is_new:
        device = Device(inventory_number=inventory_number)
        db.add(device)
    device.ip_address = data.get("ip_address")
    device.page_counter = data.get("page_counter")
    device.counter_checked_at = data.get("counter_checked_at")
    device.serial_number = data.get("serial_number")
    device.manufacturer = data.get("manufacturer") or "Не указан"
    device.model = data.get("model") or "Не указана"
    device.device_type = DeviceType(data.get("device_type") or DeviceType.printer.value)
    device.department_id = department_id
    device.location = data.get("location")
    device.purchase_date = _parse_optional_date(data.get("purchase_date"))
    device.warranty_until = _parse_optional_date(data.get("warranty_until"))
    device.status = DeviceStatus(data.get("status") or DeviceStatus.active.value)
    device.notes = data.get("notes")
    manufacturer_name = device.manufacturer.strip()
    if manufacturer_name and not db.query(Manufacturer.id).filter(Manufacturer.name == manufacturer_name).first():
        db.add(Manufacturer(name=manufacturer_name))
    db.flush()

    if is_new:
        for record in data.get("repairs") or []:
            db.add(RepairRecord(
                device_id=device.id,
                date=_parse_optional_date(record.get("date")) or date.today(),
                repair_type=RepairType(record.get("repair_type") or RepairType.unplanned.value),
                repair_status=RepairStatus(record.get("repair_status") or RepairStatus.completed.value),
                description=record.get("description") or "Импортированная запись",
                contractor=record.get("contractor"),
                cost=record.get("cost") or 0,
                page_counter=record.get("page_counter"),
                completion_page_counter=record.get("completion_page_counter"),
                page_counter_delta=record.get("page_counter_delta"),
                notes=record.get("notes"),
            ))
        for record in data.get("consumables") or []:
            db.add(ConsumableLog(
                device_id=device.id,
                date=_parse_optional_date(record.get("date")) or date.today(),
                item_type=ItemType(record.get("item_type") or ItemType.other.value),
                quantity=record.get("quantity") or 1,
                unit_cost=record.get("unit_cost") or 0,
                page_counter=record.get("page_counter"),
                notes=record.get("notes"),
            ))
    return "created" if is_new else "updated"


def _import_warehouse_item(db: Session, inventory_number: str, data: dict) -> tuple[str, WarehouseItem]:
    owner = inventory_number_owner(db, inventory_number)
    if owner and owner != "warehouse_item":
        raise ValueError("инвентарный номер уже занят устройством")
    item = db.query(WarehouseItem).filter(WarehouseItem.inventory_number == inventory_number).first()
    is_new = item is None
    branch_id, department_id = _organization(db, data)
    if is_new:
        item = WarehouseItem(inventory_number=inventory_number)
        db.add(item)
    item.sku = data.get("article")
    item.name = data.get("name") or "Оборудование"
    item.category = data.get("category") or "Прочее"
    item.branch_id = branch_id
    item.department_id = department_id
    tracking_type = data.get("tracking_type") or "asset"
    if tracking_type not in {"asset", "quantity"}:
        raise ValueError("неизвестный способ учёта")
    item.tracking_type = tracking_type
    item.serial_number = data.get("serial_number")
    item.manufacturer = data.get("manufacturer")
    item.model = data.get("model")
    item.placement = data.get("placement") or "Склад/серверная"
    item.condition = data.get("condition") or "На складе"
    item.compatible_printers = data.get("compatible_printers")
    item.monitor_diagonal = data.get("monitor_diagonal")
    item.color = data.get("color")
    item.ram_gb = data.get("ram_gb")
    item.processor = data.get("processor")
    item.graphics = data.get("graphics")
    item.storage_type = data.get("storage_type")
    item.storage_capacity_gb = data.get("storage_capacity_gb")
    item.unit = data.get("unit") or "шт."
    item.min_quantity = data.get("min_quantity") or 0
    item.notes = data.get("notes")
    db.flush()
    if is_new:
        movements = data.get("movements") or []
        if not movements:
            movements = [{
                "date": date.today().isoformat(),
                "movement_type": StockMovementType.receipt.value,
                "quantity": max(1, int(data.get("current_quantity") or 1)),
                "notes": "Импортированный остаток",
            }]
        for record in movements:
            db.add(StockMovement(
                item_id=item.id,
                date=_parse_optional_date(record.get("date")) or date.today(),
                movement_type=StockMovementType(record.get("movement_type")),
                quantity=record.get("quantity") or 1,
                notes=record.get("notes"),
            ))
    return ("created" if is_new else "updated"), item


def _card_from_text(content: bytes) -> dict:
    text = content.decode("utf-8-sig")
    if JSON_MARKER not in text:
        raise ValueError("в TXT отсутствует блок данных для импорта")
    return json.loads(text.split(JSON_MARKER, 1)[1].strip())


@router.post("/archive")
async def import_inventory_archive(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="Выберите ZIP-архив инвентаря")

    temp = tempfile.NamedTemporaryFile(prefix="inventory-import-", suffix=".zip", delete=False)
    temp_path = temp.name
    total = 0
    try:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail="Размер архива не должен превышать 512 МБ")
            temp.write(chunk)
        temp.close()
        try:
            archive = zipfile.ZipFile(temp_path)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=422, detail="Не удалось открыть ZIP-архив") from exc

        with archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise HTTPException(status_code=422, detail="В архиве слишком много файлов")
            if sum(entry.file_size for entry in entries) > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail="Распакованный архив превышает 512 МБ")

            cards: dict[str, dict] = {}
            photo_entries: dict[str, list[zipfile.ZipInfo]] = {}
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if entry.is_dir() or len(path.parts) != 2:
                    continue
                try:
                    inventory_number = require_inventory_number(path.parts[0])
                except ValueError:
                    # Служебные каталоги ZIP (например, __MACOSX) не относятся к карточкам.
                    continue
                if path.name == f"{inventory_number}.txt":
                    if entry.file_size > 2 * 1024 * 1024:
                        raise ValueError(f"{inventory_number}: TXT-файл слишком большой")
                    cards[inventory_number] = _card_from_text(archive.read(entry))
                elif path.suffix.lower() in IMAGE_TYPES:
                    photo_entries.setdefault(inventory_number, []).append(entry)

            if not cards:
                raise HTTPException(status_code=422, detail="В архиве нет инвентарных TXT-карточек")

            result = {"created": 0, "updated": 0, "photos": 0, "errors": []}
            item_by_number: dict[str, WarehouseItem] = {}
            with inventory_number_lock:
                for inventory_number, card in sorted(cards.items()):
                    try:
                        if card.get("archive_version") != ARCHIVE_VERSION:
                            raise ValueError("неподдерживаемая версия карточки")
                        if card.get("inventory_number") != inventory_number:
                            raise ValueError("номер папки не совпадает с номером в TXT")
                        if not isinstance(card.get("data"), dict):
                            raise ValueError("в TXT отсутствуют данные карточки")
                        if card.get("entity_type") == "device":
                            action = _import_device(db, inventory_number, card.get("data") or {})
                        elif card.get("entity_type") == "warehouse_item":
                            action, item = _import_warehouse_item(db, inventory_number, card.get("data") or {})
                            if item.tracking_type == "asset":
                                item_by_number[inventory_number] = item
                        else:
                            raise ValueError("неизвестный тип записи")
                        db.commit()
                        result[action] += 1
                    except Exception as exc:
                        db.rollback()
                        result["errors"].append(f"{inventory_number}: {exc}")

            for inventory_number, entries_for_item in photo_entries.items():
                if inventory_number not in item_by_number:
                    continue
                directory = photo_directory(inventory_number)
                directory.mkdir(parents=True, exist_ok=True)
                existing_names = {path.name for path in photo_files(inventory_number)}
                for entry in sorted(entries_for_item, key=lambda value: value.filename):
                    filename = PurePosixPath(entry.filename).name
                    if filename not in existing_names and len(existing_names) >= MAX_PHOTOS_PER_ITEM:
                        result["errors"].append(f"{inventory_number}: достигнут лимит фотографий")
                        break
                    content = archive.read(entry)
                    detected_extension = image_extension(content[:16])
                    if len(content) > MAX_PHOTO_BYTES or detected_extension is None:
                        result["errors"].append(f"{inventory_number}: пропущен файл {PurePosixPath(entry.filename).name}")
                        continue
                    source_extension = Path(filename).suffix.lower()
                    if source_extension == ".jpeg":
                        source_extension = ".jpg"
                    if source_extension != detected_extension:
                        filename = f"{Path(filename).stem}{detected_extension}"
                    (directory / filename).write_bytes(content)
                    existing_names.add(filename)
                    result["photos"] += 1
                normalize_photo_filenames(inventory_number)
            return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        temp.close()
        await file.close()
        _remove_file(temp_path)
