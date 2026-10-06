from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from database import get_db
from digital_document_import import MAX_FILE_BYTES, import_documents
from digital_document_schemas import (
    PowerOfAttorneyCreate, PowerOfAttorneyRead, PowerOfAttorneyUpdate,
    SignatureCreate, SignatureRead, SignatureUpdate,
)
from models import ElectronicSignature, MachineReadablePowerOfAttorney
from routers.auth import get_current_user


router = APIRouter(dependencies=[Depends(get_current_user)])
REGISTER_TIMEZONE = timezone(timedelta(hours=4))  # Calendar dates in Saratov, UTC+04:00.


def register_today():
    return datetime.now(REGISTER_TIMEZONE).date()


def term_status(valid_from, valid_to, today):
    days_left = (valid_to - today).days
    if today < valid_from:
        return "not_started", days_left
    if today > valid_to:
        return "expired", days_left
    return ("expiring" if days_left <= 30 else "valid"), days_left


def read_document(record, create_schema, read_schema):
    data = {name: getattr(record, name) for name in create_schema.model_fields}
    # SQLite returns naive datetime values; this register stores timestamps in UTC.
    if isinstance(data.get("revoked_at"), datetime) and data["revoked_at"].tzinfo is None:
        data["revoked_at"] = data["revoked_at"].replace(tzinfo=timezone.utc)
    computed, days_left = term_status(record.valid_from, record.valid_to, register_today())
    return read_schema(**data, id=record.id, created_at=record.created_at, updated_at=record.updated_at,
                       is_archived=record.is_archived, archived_at=record.archived_at,
                       term_status=computed, days_left=days_left)


def get_document(db, model, document_id):
    record = db.get(model, document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return record


def create_document(db, model, payload):
    record = model(**payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_document(db, model, document_id, payload, create_schema):
    record = get_document(db, model, document_id)
    if record.is_archived:
        raise HTTPException(status_code=409, detail="Сначала восстановите запись из архива")
    # Validate partial updates against the entire current record, including dates and required fields.
    merged = {name: getattr(record, name) for name in create_schema.model_fields}
    if isinstance(merged.get("revoked_at"), datetime) and merged["revoked_at"].tzinfo is None:
        merged["revoked_at"] = merged["revoked_at"].replace(tzinfo=timezone.utc)
    merged.update(payload.model_dump(exclude_unset=True))
    try:
        validated = create_schema.model_validate(merged)
    except ValidationError as exc:
        errors = [{"loc": ["body", *error["loc"]], "msg": error["msg"], "type": error["type"]}
                  for error in exc.errors(include_context=False, include_input=False, include_url=False)]
        raise HTTPException(status_code=422, detail=errors) from exc
    for name, value in validated.model_dump().items():
        setattr(record, name, value)
    db.commit()
    db.refresh(record)
    return record


def archive_document(db, model, document_id):
    record = get_document(db, model, document_id)
    if not record.is_archived:
        record.is_archived = True
        record.archived_at = datetime.now(timezone.utc)
        db.commit()


def restore_document(db, model, document_id):
    record = get_document(db, model, document_id)
    if record.is_archived:
        record.is_archived = False
        record.archived_at = None
        db.commit()
        db.refresh(record)
    return record


def signature_read(record):
    return read_document(record, SignatureCreate, SignatureRead)


def power_read(record):
    return read_document(record, PowerOfAttorneyCreate, PowerOfAttorneyRead)


@router.post("/import-xlsx")
def import_xlsx(apply: bool = False, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(status_code=422, detail='Выберите файл в формате .xlsx')
    contents = file.file.read(MAX_FILE_BYTES + 1)
    try:
        return import_documents(db, contents, apply=apply)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/signatures", response_model=list[SignatureRead])
def list_signatures(archived: bool = False, db: Session = Depends(get_db)):
    rows = db.query(ElectronicSignature).filter(ElectronicSignature.is_archived.is_(archived))
    return [signature_read(row) for row in rows.order_by(ElectronicSignature.valid_to, ElectronicSignature.id)]


@router.post("/signatures", response_model=SignatureRead, status_code=status.HTTP_201_CREATED)
def create_signature(payload: SignatureCreate, db: Session = Depends(get_db)):
    return signature_read(create_document(db, ElectronicSignature, payload))


@router.get("/signatures/{document_id}", response_model=SignatureRead)
def get_signature(document_id: int, db: Session = Depends(get_db)):
    return signature_read(get_document(db, ElectronicSignature, document_id))


@router.put("/signatures/{document_id}", response_model=SignatureRead)
def update_signature(document_id: int, payload: SignatureUpdate, db: Session = Depends(get_db)):
    return signature_read(update_document(db, ElectronicSignature, document_id, payload, SignatureCreate))


@router.delete("/signatures/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_signature(document_id: int, db: Session = Depends(get_db)):
    archive_document(db, ElectronicSignature, document_id)


@router.post("/signatures/{document_id}/restore", response_model=SignatureRead)
def restore_signature(document_id: int, db: Session = Depends(get_db)):
    return signature_read(restore_document(db, ElectronicSignature, document_id))


@router.get("/powers-of-attorney", response_model=list[PowerOfAttorneyRead])
def list_powers(archived: bool = False, db: Session = Depends(get_db)):
    rows = db.query(MachineReadablePowerOfAttorney).filter(MachineReadablePowerOfAttorney.is_archived.is_(archived))
    return [power_read(row) for row in rows.order_by(MachineReadablePowerOfAttorney.valid_to, MachineReadablePowerOfAttorney.id)]


@router.post("/powers-of-attorney", response_model=PowerOfAttorneyRead, status_code=status.HTTP_201_CREATED)
def create_power(payload: PowerOfAttorneyCreate, db: Session = Depends(get_db)):
    return power_read(create_document(db, MachineReadablePowerOfAttorney, payload))


@router.get("/powers-of-attorney/{document_id}", response_model=PowerOfAttorneyRead)
def get_power(document_id: int, db: Session = Depends(get_db)):
    return power_read(get_document(db, MachineReadablePowerOfAttorney, document_id))


@router.put("/powers-of-attorney/{document_id}", response_model=PowerOfAttorneyRead)
def update_power(document_id: int, payload: PowerOfAttorneyUpdate, db: Session = Depends(get_db)):
    return power_read(update_document(db, MachineReadablePowerOfAttorney, document_id, payload, PowerOfAttorneyCreate))


@router.delete("/powers-of-attorney/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_power(document_id: int, db: Session = Depends(get_db)):
    archive_document(db, MachineReadablePowerOfAttorney, document_id)


@router.post("/powers-of-attorney/{document_id}/restore", response_model=PowerOfAttorneyRead)
def restore_power(document_id: int, db: Session = Depends(get_db)):
    return power_read(restore_document(db, MachineReadablePowerOfAttorney, document_id))
