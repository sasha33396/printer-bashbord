from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import StockMovement, StockMovementType, WarehouseItem
from routers.auth import get_current_user
from schemas import (
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


def _item_read(item: WarehouseItem, quantity: int) -> WarehouseItemRead:
    return WarehouseItemRead(
        id=item.id,
        sku=item.sku,
        name=item.name,
        category=item.category,
        unit=item.unit,
        min_quantity=item.min_quantity,
        current_quantity=quantity,
        notes=item.notes,
    )


@router.get("/items", response_model=List[WarehouseItemRead])
def list_items(
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    items = db.query(WarehouseItem).order_by(WarehouseItem.category, WarehouseItem.name).all()
    return [_item_read(item, _current_quantity(db, item.id)) for item in items]


@router.post("/items", response_model=WarehouseItemRead, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: WarehouseItemCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = WarehouseItem(
        sku=_normalize_optional(payload.sku),
        name=_required_text(payload.name, "Наименование"),
        category=_required_text(payload.category, "Категория"),
        unit=_required_text(payload.unit, "Единица"),
        min_quantity=payload.min_quantity,
        notes=_normalize_optional(payload.notes),
    )
    db.add(item)
    try:
        db.flush()
        if payload.initial_quantity:
            db.add(StockMovement(
                item_id=item.id,
                date=date.today(),
                movement_type=StockMovementType.receipt,
                quantity=payload.initial_quantity,
                notes="Начальный остаток",
            ))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Позиция с таким артикулом уже существует") from exc
    db.refresh(item)
    return _item_read(item, payload.initial_quantity)


@router.put("/items/{item_id}", response_model=WarehouseItemRead)
def update_item(
    item_id: int,
    payload: WarehouseItemUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "category", "unit"):
        if field in data:
            data[field] = data[field].strip()
            if not data[field]:
                raise HTTPException(status_code=422, detail=f"Поле «{field}» не может быть пустым")
    if "sku" in data:
        data["sku"] = _normalize_optional(data["sku"])
    if "notes" in data:
        data["notes"] = _normalize_optional(data["notes"])
    for field, value in data.items():
        setattr(item, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Позиция с таким артикулом уже существует") from exc
    db.refresh(item)
    return _item_read(item, _current_quantity(db, item.id))


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    item = _get_item_or_404(db, item_id)
    if db.query(StockMovement.id).filter(StockMovement.item_id == item_id).first():
        raise HTTPException(
            status_code=409,
            detail="Нельзя удалить позицию с историей движений",
        )
    db.delete(item)
    db.commit()


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
    _: dict = _auth,
):
    _get_item_or_404(db, item_id)
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
    db.commit()
    db.refresh(movement)
    return movement


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(
    movement_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
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
    db.delete(movement)
    db.commit()
