from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Device, RepairRecord
from routers.auth import get_current_user
from schemas import RepairRecordCreate, RepairRecordUpdate, RepairRecordRead

router = APIRouter()

_auth = Depends(get_current_user)


def _get_or_404(db: Session, repair_id: int) -> RepairRecord:
    record = db.get(RepairRecord, repair_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repair record not found")
    return record


def _with_device(db: Session):
    return db.query(RepairRecord).options(joinedload(RepairRecord.device))


@router.get("", response_model=List[RepairRecordRead])
def list_repairs(
    device_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    q = _with_device(db)
    if device_id is not None:
        if not db.get(Device, device_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
        q = q.filter(RepairRecord.device_id == device_id)
    return q.order_by(RepairRecord.date.desc()).all()


@router.post("", response_model=RepairRecordRead, status_code=status.HTTP_201_CREATED)
def create_repair(
    payload: RepairRecordCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if not db.get(Device, payload.device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    record = RepairRecord(**payload.model_dump())
    db.add(record)
    db.commit()
    return _with_device(db).filter(RepairRecord.id == record.id).first()


@router.put("/{repair_id}", response_model=RepairRecordRead)
def update_repair(
    repair_id: int,
    payload: RepairRecordUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, repair_id)
    data = payload.model_dump(exclude_unset=True)
    if "device_id" in data and not db.get(Device, data["device_id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    for field, value in data.items():
        setattr(record, field, value)
    db.commit()
    return _with_device(db).filter(RepairRecord.id == repair_id).first()


@router.delete("/{repair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    db.delete(_get_or_404(db, repair_id))
    db.commit()
