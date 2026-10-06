from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from equipment_history import actor_name, add_item_event, changed_values
from inventory_numbers import (
    inventory_number_lock, inventory_number_owner,
    require_inventory_number,
)
from models import (
    Branch, Department, StockMovement, StockMovementType,
    WarehouseItem, Workplace, WorkplaceAssetAssignment,
)
from routers.auth import get_current_user
from photo_storage import (
    IMAGE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ITEM,
    delete_photo_directory, equipment_photo_key, image_extension, photo_digest,
    move_photo_directory, next_photo_filename, normalize_photo_filenames,
    photo_directory, photo_file, photo_files,
)
from schemas import (
    EquipmentPhotoRead,
    StockMovementCreate,
    StockMovementRead,
    WarehouseItemCreate,
    WarehouseItemRead,
    WarehouseItemUpdate,
)
from stock import movement_delta

router = APIRouter()
_auth = Depends(get_current_user)


def _get_item_or_404(db: Session, item_id: int) -> WarehouseItem:
    item = db.get(WarehouseItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Позиция не найдена")
    return item


def _photo_item_or_404(db: Session, item_id: int) -> WarehouseItem:
    item = _get_item_or_404(db, item_id)
    if item.tracking_type != "asset":
        raise HTTPException(
            status_code=422,
            detail="Фотографии доступны для оборудования с поштучным учётом",
        )
    return item


def _photo_read(path: Path) -> EquipmentPhotoRead:
    stat = path.stat()
    return EquipmentPhotoRead(
        filename=path.name,
        size=stat.st_size,
        created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


def _normalize_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _required_text(value: str, label: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(status_code=422, detail=f"Поле «{label}» не может быть пустым")
    return value


def _validate_location(
    db: Session,
    branch_id: Optional[int],
    department_id: Optional[int],
) -> None:
    if branch_id is not None and not db.get(Branch, branch_id):
        raise HTTPException(status_code=422, detail="Выберите существующий филиал")
    if department_id is not None:
        department = db.get(Department, department_id)
        if branch_id is None or not department or department.branch_id != branch_id:
            raise HTTPException(status_code=422, detail="Отдел не относится к выбранному филиалу")


def _validate_unique_sku(
    db: Session,
    sku: Optional[str],
    branch_id: Optional[int],
    department_id: Optional[int],
    exclude_item_id: Optional[int] = None,
) -> None:
    if not sku:
        return
    query = db.query(WarehouseItem.id).filter(
        WarehouseItem.sku == sku,
        WarehouseItem.branch_id == branch_id,
        WarehouseItem.department_id == department_id,
    )
    if exclude_item_id is not None:
        query = query.filter(WarehouseItem.id != exclude_item_id)
    if query.first():
        raise HTTPException(
            status_code=409,
            detail="Позиция с таким артикулом уже есть на выбранном складе",
        )


def _validate_inventory_number(
    db: Session,
    inventory_number: Optional[str],
    tracking_type: str,
    exclude_item_id: Optional[int] = None,
) -> None:
    if not inventory_number:
        return
    try:
        require_inventory_number(inventory_number)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if inventory_number_owner(db, inventory_number, exclude_item_id=exclude_item_id):
        raise HTTPException(status_code=409, detail="Такой инвентарный номер уже используется")


def _current_quantity(db: Session, item_id: int) -> int:
    value = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (StockMovement.movement_type == StockMovementType.receipt, StockMovement.quantity),
                        else_=-StockMovement.quantity,
                    )
                ),
                0,
            )
        )
        .filter(StockMovement.item_id == item_id)
        .scalar()
    )
    return int(value or 0)


def _item_read(item: WarehouseItem, quantity: int, workplace=None) -> WarehouseItemRead:
    return WarehouseItemRead(
        id=item.id,
        sku=item.sku,
        name=item.name,
        category=item.category,
        branch_id=item.branch_id,
        department_id=item.department_id,
        branch=item.branch,
        department=item.department,
        tracking_type=item.tracking_type,
        inventory_number=item.inventory_number,
        serial_number=item.serial_number,
        manufacturer=item.manufacturer,
        model=item.model,
        ip_address=item.ip_address,
        mac_address=item.mac_address,
        placement=item.placement,
        condition=item.condition,
        compatible_printers=item.compatible_printers,
        monitor_diagonal=item.monitor_diagonal,
        color=item.color,
        ram_gb=item.ram_gb,
        processor=item.processor,
        graphics=item.graphics,
        os_name=item.os_name,
        os_version=item.os_version,
        storage_type=item.storage_type,
        storage_capacity_gb=item.storage_capacity_gb,
        unit=item.unit,
        min_quantity=item.min_quantity,
        current_quantity=quantity,
        notes=item.notes,
        workplace=workplace,
        responsible_person=(workplace.employee.full_name if workplace and workplace.employee else None),
        is_archived=item.is_archived,
        archived_at=item.archived_at,
    )


@router.get("/items", response_model=List[WarehouseItemRead])
def list_items(
    archived: Optional[bool] = False,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    items = (
        db.query(WarehouseItem)
        .options(joinedload(WarehouseItem.branch), joinedload(WarehouseItem.department))
        .filter(WarehouseItem.is_archived.is_(archived))
        .order_by(WarehouseItem.category, WarehouseItem.name)
        .all()
    )
    return [_item_read(item, _current_quantity(db, item.id)) for item in items]


@router.get("/items/{item_id}", response_model=WarehouseItemRead)
def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = (
        db.query(WarehouseItem)
        .options(joinedload(WarehouseItem.branch), joinedload(WarehouseItem.department))
        .filter(WarehouseItem.id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Позиция не найдена")
    assignment = (
        db.query(WorkplaceAssetAssignment)
        .options(joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.employee))
        .filter(
            WorkplaceAssetAssignment.item_id == item.id,
            WorkplaceAssetAssignment.ended_at.is_(None),
        )
        .first()
    )
    return _item_read(
        item,
        _current_quantity(db, item.id),
        workplace=assignment.workplace if assignment else None,
    )


@router.get("/items/{item_id}/photos", response_model=List[EquipmentPhotoRead])
def list_item_photos(
    item_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _photo_item_or_404(db, item_id)
    return [_photo_read(path) for path in photo_files(equipment_photo_key("warehouse_item", item.id, item.inventory_number))]


@router.get("/items/{item_id}/photos/{filename}")
def get_item_photo(
    item_id: int,
    filename: str,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _photo_item_or_404(db, item_id)
    try:
        path = photo_file(equipment_photo_key("warehouse_item", item.id, item.inventory_number), filename)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Фотография не найдена") from exc
    if not path.is_file() or path.is_symlink():
        raise HTTPException(status_code=404, detail="Фотография не найдена")
    return FileResponse(
        path,
        media_type=IMAGE_TYPES[path.suffix.lower()],
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post(
    "/items/{item_id}/photos",
    response_model=List[EquipmentPhotoRead],
    status_code=status.HTTP_201_CREATED,
)
async def upload_item_photos(
    item_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _photo_item_or_404(db, item_id)
    existing = photo_files(equipment_photo_key("warehouse_item", item.id, item.inventory_number))
    if not files:
        raise HTTPException(status_code=422, detail="Выберите фотографии")
    if len(existing) + len(files) > MAX_PHOTOS_PER_ITEM:
        raise HTTPException(
            status_code=409,
            detail=f"Для одного оборудования можно сохранить не более {MAX_PHOTOS_PER_ITEM} фотографий",
        )

    directory = photo_directory(equipment_photo_key("warehouse_item", item.id, item.inventory_number))
    directory.mkdir(parents=True, exist_ok=True)
    normalize_photo_filenames(equipment_photo_key("warehouse_item", item.id, item.inventory_number))
    saved: List[Path] = []
    temporary: List[Path] = []
    try:
        for upload in files:
            temp_path = directory / f".{uuid4().hex}.tmp"
            temporary.append(temp_path)
            size = 0
            header = b""
            with temp_path.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_PHOTO_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="Размер одной фотографии не должен превышать 10 МБ",
                        )
                    if len(header) < 16:
                        header = (header + chunk)[:16]
                    output.write(chunk)
            extension = image_extension(header)
            if extension is None:
                raise HTTPException(
                    status_code=415,
                    detail="Поддерживаются фотографии JPEG, PNG и WebP",
                )
            filename = next_photo_filename(equipment_photo_key("warehouse_item", item.id, item.inventory_number), extension)
            target = directory / filename
            temp_path.replace(target)
            temporary.remove(temp_path)
            saved.append(target)
    except Exception:
        for path in saved + temporary:
            path.unlink(missing_ok=True)
        if directory.exists() and not any(directory.iterdir()):
            directory.rmdir()
        raise
    finally:
        for upload in files:
            await upload.close()

    return [_photo_read(path) for path in photo_files(equipment_photo_key("warehouse_item", item.id, item.inventory_number))]


@router.delete("/items/{item_id}/photos/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_photo(
    item_id: int,
    filename: str,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _photo_item_or_404(db, item_id)
    try:
        path = photo_file(equipment_photo_key("warehouse_item", item.id, item.inventory_number), filename)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Фотография не найдена") from exc
    if not path.is_file() or path.is_symlink():
        raise HTTPException(status_code=404, detail="Фотография не найдена")
    removed_digest = photo_digest(path)
    path.unlink()
    directory = path.parent
    if not any(directory.iterdir()):
        directory.rmdir()
    else:
        normalize_photo_filenames(equipment_photo_key("warehouse_item", item.id, item.inventory_number))
    digest_still_exists = any(
        photo_digest(candidate) == removed_digest
        for candidate in photo_files(equipment_photo_key("warehouse_item", item.id, item.inventory_number))
    )
    if not digest_still_exists:
        db.query(Workplace).filter(
            Workplace.photo_item_id == item.id,
            Workplace.photo_hash == removed_digest,
        ).update({
            Workplace.photo_item_id: None,
            Workplace.photo_hash: None,
        }, synchronize_session=False)
        db.commit()


@router.post("/items", response_model=WarehouseItemRead, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: WarehouseItemCreate,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    _validate_location(db, payload.branch_id, payload.department_id)
    sku = _normalize_optional(payload.sku)
    requested_inventory_number = _normalize_optional(payload.inventory_number)
    _validate_unique_sku(db, sku, payload.branch_id, payload.department_id)
    with inventory_number_lock:
        inventory_number = requested_inventory_number
        _validate_inventory_number(db, inventory_number, payload.tracking_type)
        item = WarehouseItem(
            sku=sku,
            name=_required_text(payload.name, "Наименование"),
            category=_required_text(payload.category, "Категория"),
            branch_id=payload.branch_id,
            department_id=payload.department_id,
            tracking_type=payload.tracking_type,
            inventory_number=inventory_number,
            serial_number=_normalize_optional(payload.serial_number),
            manufacturer=_normalize_optional(payload.manufacturer),
            model=_normalize_optional(payload.model),
            ip_address=payload.ip_address,
            mac_address=payload.mac_address,
            placement=_required_text(
                payload.placement if payload.branch_id is not None or "placement" in payload.model_fields_set
                else "Не определено", "Местонахождение",
            ),
            condition=_required_text(payload.condition, "Состояние"),
            compatible_printers=_normalize_optional(payload.compatible_printers),
            monitor_diagonal=payload.monitor_diagonal,
            color=_normalize_optional(payload.color),
            ram_gb=payload.ram_gb,
            processor=_normalize_optional(payload.processor),
            graphics=_normalize_optional(payload.graphics),
            os_name=_normalize_optional(payload.os_name),
            os_version=_normalize_optional(payload.os_version),
            storage_type=_normalize_optional(payload.storage_type),
            storage_capacity_gb=payload.storage_capacity_gb,
            unit=_required_text(payload.unit, "Единица"),
            min_quantity=payload.min_quantity,
            notes=_normalize_optional(payload.notes),
        )
        db.add(item)
        try:
            db.flush()
            initial_quantity = 1 if payload.tracking_type == "asset" else payload.initial_quantity
            if initial_quantity:
                db.add(StockMovement(
                    item_id=item.id,
                    date=date.today(),
                    movement_type=StockMovementType.receipt,
                    quantity=initial_quantity,
                    notes="Начальный остаток",
                ))
            db.flush()
            add_item_event(
                db,
                item,
                category="equipment",
                event_type="created",
                title="Оборудование добавлено" if item.tracking_type == "asset" else "Номенклатура добавлена",
                actor=actor_name(current_user),
                effective_date=date.today(),
                details=f"Начальный остаток: {initial_quantity} {item.unit}",
            )
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="Позиция с таким артикулом уже существует") from exc
    db.refresh(item)
    return _item_read(item, 1 if payload.tracking_type == "asset" else payload.initial_quantity)


@router.put("/items/{item_id}", response_model=WarehouseItemRead)
def update_item(
    item_id: int,
    payload: WarehouseItemUpdate,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    data = payload.model_dump(exclude_unset=True)
    before = {field: getattr(item, field) for field in data}
    if "branch_id" in data and data["branch_id"] != item.branch_id and "department_id" not in data:
        data["department_id"] = None
    branch_id = data.get("branch_id", item.branch_id)
    department_id = data.get("department_id", item.department_id)
    _validate_location(db, branch_id, department_id)
    for field in ("name", "category", "unit", "placement", "condition"):
        if field in data:
            data[field] = data[field].strip()
            if not data[field]:
                raise HTTPException(status_code=422, detail=f"Поле «{field}» не может быть пустым")
    optional_text_fields = (
        "sku", "inventory_number", "serial_number", "manufacturer", "model",
        "compatible_printers", "color", "processor", "graphics", "os_name", "os_version", "storage_type", "notes",
    )
    for field in optional_text_fields:
        if field in data:
            data[field] = _normalize_optional(data[field])
    sku = data.get("sku", item.sku)
    _validate_unique_sku(db, sku, branch_id, department_id, exclude_item_id=item.id)
    tracking_type = data.get("tracking_type", item.tracking_type)
    inventory_number = data.get("inventory_number", item.inventory_number)
    old_inventory_number = item.inventory_number
    new_inventory_number = inventory_number
    old_photo_key = equipment_photo_key("warehouse_item", item.id, old_inventory_number)
    new_photo_key = equipment_photo_key("warehouse_item", item.id, new_inventory_number)
    moved_photos = False
    with inventory_number_lock:
        _validate_inventory_number(db, inventory_number, tracking_type, exclude_item_id=item.id)
        if new_inventory_number != old_inventory_number:
            if photo_directory(new_photo_key).exists():
                raise HTTPException(
                    status_code=409,
                    detail="Каталог нового инвентарного номера уже существует",
                )
            try:
                moved_photos = move_photo_directory(old_photo_key, new_photo_key)
            except FileExistsError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc

        for field, value in data.items():
            setattr(item, field, value)
        try:
            db.flush()
            db.expire(item, ["branch", "department"])
            changes = changed_values(before, data, {
                "inventory_number": "Инвентарный номер",
                "name": "Наименование",
                "category": "Категория",
                "branch_id": "Филиал",
                "department_id": "Отдел",
                "placement": "Местонахождение",
                "condition": "Состояние",
                "serial_number": "Серийный номер",
                "manufacturer": "Производитель",
                "model": "Модель",
                "ip_address": "IP-адрес",
                "mac_address": "MAC-адрес",
                "ram_gb": "ОЗУ, ГБ",
                "processor": "Процессор",
                "graphics": "Видеокарта",
                "storage_type": "Накопитель",
                "storage_capacity_gb": "Объём, ГБ",
            })
            if changes:
                add_item_event(
                    db,
                    item,
                    category="equipment",
                    event_type="updated",
                    title="Карточка оборудования изменена",
                    actor=actor_name(current_user),
                    changes=changes,
                )
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            if moved_photos:
                move_photo_directory(new_photo_key, old_photo_key)
            raise HTTPException(status_code=409, detail="Позиция с такими данными уже существует") from exc
        except Exception:
            db.rollback()
            if moved_photos:
                move_photo_directory(new_photo_key, old_photo_key)
            raise
    db.refresh(item)
    return _item_read(item, _current_quantity(db, item.id))


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    if item.is_archived:
        raise HTTPException(status_code=409, detail="Оборудование уже находится в архиве")
    if db.query(WorkplaceAssetAssignment.id).filter(
        WorkplaceAssetAssignment.item_id == item_id,
        WorkplaceAssetAssignment.ended_at.is_(None),
    ).first():
        raise HTTPException(
            status_code=409,
            detail="Сначала снимите оборудование с рабочего места",
        )
    item.is_archived = True
    item.archived_at = datetime.now(timezone.utc)
    add_item_event(
        db,
        item,
        category="equipment",
        event_type="archived",
        title="Оборудование перемещено в архив",
        actor=actor_name(current_user),
    )
    db.commit()


@router.post("/items/{item_id}/restore", response_model=WarehouseItemRead)
def restore_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    if not item.is_archived:
        raise HTTPException(status_code=409, detail="Оборудование не находится в архиве")
    item.is_archived = False
    item.archived_at = None
    add_item_event(
        db,
        item,
        category="equipment",
        event_type="restored",
        title="Оборудование восстановлено из архива",
        actor=actor_name(current_user),
    )
    db.commit()
    db.refresh(item)
    return _item_read(item, _current_quantity(db, item.id))


@router.get("/items/{item_id}/movements", response_model=List[StockMovementRead])
def list_movements(
    item_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    _get_item_or_404(db, item_id)
    return (
        db.query(StockMovement)
        .filter(StockMovement.item_id == item_id)
        .order_by(StockMovement.date.desc(), StockMovement.id.desc())
        .all()
    )


@router.post(
    "/items/{item_id}/movements",
    response_model=StockMovementRead,
    status_code=status.HTTP_201_CREATED,
)
def create_movement(
    item_id: int,
    payload: StockMovementCreate,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    current = _current_quantity(db, item_id)
    delta = movement_delta(payload.movement_type.value, payload.quantity)
    if current + delta < 0:
        raise HTTPException(
            status_code=409,
            detail=f"Недостаточно на складе. Доступно: {current}",
        )
    movement = StockMovement(
        item_id=item_id,
        date=payload.date,
        movement_type=payload.movement_type,
        quantity=payload.quantity,
        notes=_normalize_optional(payload.notes),
    )
    db.add(movement)
    add_item_event(
        db,
        item,
        category="stock",
        event_type="stock_received" if payload.movement_type == StockMovementType.receipt else "stock_issued",
        title="Поступление на склад" if payload.movement_type == StockMovementType.receipt else "Выдача со склада",
        actor=actor_name(current_user),
        effective_date=payload.date,
        details=f"Количество: {payload.quantity} {item.unit}" + (f". {payload.notes}" if payload.notes else ""),
    )
    db.commit()
    db.refresh(movement)
    return movement


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(
    movement_id: int,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    movement = db.get(StockMovement, movement_id)
    if not movement:
        raise HTTPException(status_code=404, detail="Операция не найдена")
    current = _current_quantity(db, movement.item_id)
    delta = movement_delta(movement.movement_type.value, movement.quantity)
    if current - delta < 0:
        raise HTTPException(
            status_code=409,
            detail="Нельзя удалить поступление: остаток станет отрицательным",
        )
    item = _get_item_or_404(db, movement.item_id)
    add_item_event(
        db,
        item,
        category="stock",
        event_type="stock_movement_deleted",
        title="Складская операция удалена",
        actor=actor_name(current_user),
        effective_date=movement.date,
        details=f"{movement.movement_type.value}: {movement.quantity} {item.unit}",
    )
    db.delete(movement)
    db.commit()
