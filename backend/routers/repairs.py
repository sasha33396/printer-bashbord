import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Device, RepairRecord, RepairStatus, RepairWorkItem
from printer_counter import read_counter
from repair_invoice_storage import MAX_INVOICE_BYTES, delete_invoice, invoice_file
from routers.auth import get_current_user
from schemas import RepairRecordCreate, RepairRecordRead, RepairRecordUpdate

router = APIRouter()

_auth = Depends(get_current_user)


def _get_or_404(db: Session, repair_id: int) -> RepairRecord:
    record = db.get(RepairRecord, repair_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ремонт не найден")
    return record


def _with_device(db: Session):
    return db.query(RepairRecord).options(
        joinedload(RepairRecord.device),
        joinedload(RepairRecord.work_items),
    )


def _clean_optional_text(value):
    if not isinstance(value, str):
        return value
    value = value.strip()
    return value or None


def _capture_completion_counter(device: Device, manual_counter: Optional[int] = None) -> int:
    if manual_counter is not None:
        return manual_counter
    if not device.ip_address:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="У устройства не указан IP-адрес. Укажите счётчик возврата вручную",
        )
    try:
        return read_counter(device.ip_address)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=502,
            detail="Не удалось получить счётчик. Укажите значение вручную",
        ) from exc


def _update_device_counter(device: Device, counter: int) -> None:
    device.page_counter = counter
    device.counter_checked_at = datetime.now(timezone.utc).isoformat()


def _replace_work_items(record: RepairRecord, work_items) -> None:
    record.work_items.clear()
    for item in work_items:
        description = item["description"] if isinstance(item, dict) else item.description
        cost = item.get("cost", 0.0) if isinstance(item, dict) else item.cost
        record.work_items.append(RepairWorkItem(
            description=description.strip(),
            cost=cost,
        ))
    if work_items:
        record.cost = round(sum(
            item.get("cost", 0.0) if isinstance(item, dict) else item.cost
            for item in work_items
        ), 2)


def recalculate_device_repair_deltas(db: Session, device_id: int) -> None:
    records = (
        db.query(RepairRecord)
        .filter(
            RepairRecord.device_id == device_id,
            RepairRecord.repair_status == RepairStatus.completed,
        )
        .order_by(
            func.coalesce(RepairRecord.returned_date, RepairRecord.date).asc(),
            RepairRecord.id.asc(),
        )
        .all()
    )
    previous_counter: Optional[int] = None
    for record in records:
        current_counter = record.completion_page_counter
        if current_counter is None:
            record.page_counter_delta = None
            previous_counter = None
            continue
        record.page_counter_delta = (
            current_counter - previous_counter
            if previous_counter is not None and current_counter >= previous_counter
            else None
        )
        previous_counter = current_counter


def recalculate_all_repair_deltas(db: Session) -> None:
    device_ids = [row[0] for row in db.query(RepairRecord.device_id).distinct().all()]
    for device_id in device_ids:
        recalculate_device_repair_deltas(db, device_id)
    db.commit()


def _complete_repair(db: Session, record: RepairRecord) -> RepairRecord:
    if record.repair_status == RepairStatus.completed:
        return _with_device(db).filter(RepairRecord.id == record.id).first()
    device = db.get(Device, record.device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Устройство не найдено")
    end_counter = _capture_completion_counter(device)
    record.repair_status = RepairStatus.completed
    record.returned_date = record.returned_date or date.today()
    record.completion_page_counter = end_counter
    _update_device_counter(device, end_counter)
    recalculate_device_repair_deltas(db, record.device_id)
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
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Устройство не найдено")
        q = q.filter(RepairRecord.device_id == device_id)
    return q.order_by(RepairRecord.date.desc(), RepairRecord.id.desc()).all()


@router.post("", response_model=RepairRecordRead, status_code=status.HTTP_201_CREATED)
def create_repair(
    payload: RepairRecordCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    device = db.get(Device, payload.device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Устройство не найдено")

    data = payload.model_dump(exclude={"work_items", "completion_page_counter"})
    for field in ("task_url", "source_location", "responsible_person", "contractor", "notes"):
        data[field] = _clean_optional_text(data.get(field))
    record = RepairRecord(**data)
    db.add(record)
    db.flush()
    _replace_work_items(record, payload.work_items)

    if payload.repair_status == RepairStatus.completed:
        end_counter = _capture_completion_counter(device, payload.completion_page_counter)
        record.returned_date = record.returned_date or date.today()
        record.completion_page_counter = end_counter
        _update_device_counter(device, end_counter)
    recalculate_device_repair_deltas(db, record.device_id)
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
    old_device_id = record.device_id
    data = payload.model_dump(exclude_unset=True)
    work_items = data.pop("work_items", None)
    requested_completion_counter = data.pop("completion_page_counter", None)
    completion_counter_was_set = "completion_page_counter" in payload.model_fields_set
    device = db.get(Device, data.get("device_id", record.device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Устройство не найдено")

    target_status = data.get("repair_status", record.repair_status)
    completing = record.repair_status != RepairStatus.completed and target_status == RepairStatus.completed
    if completing:
        end_counter = _capture_completion_counter(device, requested_completion_counter)
        data["returned_date"] = data.get("returned_date") or date.today()
        record.completion_page_counter = end_counter
        _update_device_counter(device, end_counter)
    elif target_status == RepairStatus.completed and completion_counter_was_set:
        if requested_completion_counter is None:
            raise HTTPException(status_code=422, detail="Укажите счётчик на момент возврата")
        record.completion_page_counter = requested_completion_counter
        _update_device_counter(device, requested_completion_counter)
    elif target_status != RepairStatus.completed:
        record.completion_page_counter = None
        record.page_counter_delta = None

    for field in ("task_url", "source_location", "responsible_person", "contractor", "notes"):
        if field in data:
            data[field] = _clean_optional_text(data[field])
    for field, value in data.items():
        setattr(record, field, value)
    if work_items is not None:
        _replace_work_items(record, work_items)

    recalculate_device_repair_deltas(db, old_device_id)
    if record.device_id != old_device_id:
        recalculate_device_repair_deltas(db, record.device_id)
    db.commit()
    return _with_device(db).filter(RepairRecord.id == repair_id).first()


@router.post("/{repair_id}/complete", response_model=RepairRecordRead)
def complete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    return _complete_repair(db, _get_or_404(db, repair_id))


@router.post("/{repair_id}/invoice", response_model=RepairRecordRead)
async def upload_invoice(
    repair_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, repair_id)
    original_name = Path((file.filename or "invoice.pdf").replace("\\", "/")).name
    original_name = "".join(character for character in original_name if character not in "\r\n")[:500]
    original_name = original_name or "invoice.pdf"
    if not original_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Счёт должен быть в формате PDF")

    target = invoice_file(repair_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.parent / f".{uuid4().hex}.tmp"
    total = 0
    header = b""
    try:
        with temporary.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                if not header:
                    header = chunk[:8]
                total += len(chunk)
                if total > MAX_INVOICE_BYTES:
                    raise HTTPException(status_code=413, detail="Размер PDF не должен превышать 20 МБ")
                destination.write(chunk)
        if not header.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="Файл не является PDF-документом")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)

    record.invoice_name = original_name
    db.commit()
    return _with_device(db).filter(RepairRecord.id == repair_id).first()


@router.get("/{repair_id}/invoice")
def download_invoice(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, repair_id)
    path = invoice_file(repair_id)
    if not record.invoice_name or not path.is_file():
        raise HTTPException(status_code=404, detail="Счёт к ремонту не прикреплён")
    return FileResponse(path, media_type="application/pdf", filename=record.invoice_name)


@router.delete("/{repair_id}/invoice", status_code=status.HTTP_204_NO_CONTENT)
def remove_invoice(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, repair_id)
    delete_invoice(repair_id)
    record.invoice_name = None
    db.commit()


@router.delete("/{repair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repair(
    repair_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    record = _get_or_404(db, repair_id)
    device_id = record.device_id
    db.delete(record)
    db.flush()
    recalculate_device_repair_deltas(db, device_id)
    db.commit()
    delete_invoice(repair_id)
