from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Device, RepairRecord, RepairStatus
from printer_counter import calculate_counter_delta, read_counter
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


def _capture_completion(device: Device, start_counter: Optional[int]) -> tuple[int, int]:
    if start_counter is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Не зафиксирован счётчик на начало ремонта",
        )
    if not device.ip_address:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="У устройства не указан IP-адрес",
        )
    try:
        end_counter = read_counter(device.ip_address)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=502,
            detail="Не удалось получить счётчик для завершения ремонта",
        ) from exc
    try:
        delta = calculate_counter_delta(start_counter, end_counter)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return end_counter, delta


def _update_device_counter(device: Device, counter: int) -> None:
    device.page_counter = counter
    device.counter_checked_at = datetime.now(timezone.utc).isoformat()


def _complete_repair(db: Session, record: RepairRecord) -> RepairRecord:
    if record.repair_status == RepairStatus.completed:
        return record
    device = db.get(Device, record.device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    end_counter, delta = _capture_completion(device, record.page_counter)
    record.repair_status = RepairStatus.completed
    record.completion_page_counter = end_counter
    record.page_counter_delta = delta
    _update_device_counter(device, end_counter)
    db.commit()
    return _with_device(db).filter(RepairRecord.id == record.id).first()


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
    device = db.get(Device, payload.device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    record = RepairRecord(**payload.model_dump())
    if payload.repair_status == RepairStatus.completed:
        end_counter, delta = _capture_completion(device, payload.page_counter)
        record.completion_page_counter = end_counter
        record.page_counter_delta = delta
        _update_device_counter(device, end_counter)
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
    device = db.get(Device, data.get("device_id", record.device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    completing = (
        record.repair_status != RepairStatus.completed
        and data.get("repair_status") == RepairStatus.completed
    )
    if completing:
        start_counter = data.get("page_counter", record.page_counter)
        end_counter, delta = _capture_completion(device, start_counter)
        record.completion_page_counter = end_counter
        record.page_counter_delta = delta
        _update_device_counter(device, end_counter)
    elif "repair_status" in data and data["repair_status"] != RepairStatus.completed:
        record.completion_page_counter = None
        record.page_counter_delta = None
    for field, value in data.items():
        setattr(record, field, value)
    db.commit()
    return _with_device(db).filter(RepairRecord.id == repair_id).first()


@router.post("/{repair_id}/complete", response_model=RepairRecordRead)
def complete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    return _complete_repair(db, _get_or_404(db, repair_id))


@router.delete("/{repair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    db.delete(_get_or_404(db, repair_id))
    db.commit()
