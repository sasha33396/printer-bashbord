from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from models import Manufacturer
from schemas import ManufacturerCreate, ManufacturerRead
from routers.auth import get_current_user

router = APIRouter()

_auth = Depends(get_current_user)


@router.get("", response_model=list[ManufacturerRead])
def list_manufacturers(db: Session = Depends(get_db), _: dict = _auth):
    return db.query(Manufacturer).order_by(Manufacturer.name).all()


@router.post("", response_model=ManufacturerRead, status_code=201)
def create_manufacturer(body: ManufacturerCreate, db: Session = Depends(get_db), _: dict = _auth):
    obj = Manufacturer(name=body.name.strip())
    db.add(obj)
    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Производитель уже существует")
    return obj


@router.delete("/{manufacturer_id}", status_code=204)
def delete_manufacturer(manufacturer_id: int, db: Session = Depends(get_db), _: dict = _auth):
    obj = db.get(Manufacturer, manufacturer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Не найден")
    db.delete(obj)
    db.commit()
