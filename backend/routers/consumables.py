from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Device, ConsumableLog
from routers.auth import get_current_user
from schemas import ConsumableLogCreate, ConsumableLogUpdate, ConsumableLogRead

router = APIRouter()

_auth = Depends(get_current_user)


def _get_or_404(db: Session, log_id: int) -> ConsumableLog:
    record = db.get(ConsumableLog, log_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consumable log not found")
    return record


def _with_device(db: Session):
    return db.query(ConsumableLog).options(joinedload(ConsumableLog.device))


@router.get("", response_model=List[ConsumableLogRead])
def list_consumables(
    device_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    q = _with_device(db)
    if device_id is not None:
        if not db.get(Device, device_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
        q = q.filter(ConsumableLog.device_id == device_id)
    return q.order_by(ConsumableLog.date.desc()).all()


@router.post("", response_model=ConsumableLogRead, status_code=status.HTTP_201_CREATED)
def create_consumable(
    payload: ConsumableLogCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if not db.get(Device, payload.device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    record = ConsumableLog(**payload.model_dump())
    db.add(record)
    db.commit()
    return _with_device(db).filter(ConsumableLog.id == record.id).first()


@router.put("/{log_id}", response_model=ConsumableLogRead)
def update_consumable(
    log_id: int,
    payload: ConsumableLogUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, log_id)
    data = payload.model_dump(exclude_unset=True)
    if "device_id" in data and not db.get(Device, data["device_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    for field, value in data.items():
        setattr(record, field, value)
    db.commit()
    return _with_device(db).filter(ConsumableLog.id == log_id).first()


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_consumable(
    log_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    db.delete(_get_or_404(db, log_id))
    db.commit()
