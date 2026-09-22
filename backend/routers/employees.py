from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Branch, Department, Employee, Workplace
from routers.auth import get_current_user
from schemas import EmployeeCreate, EmployeeRead, EmployeeUpdate

router = APIRouter()
_auth = Depends(get_current_user)


def _text(value: Optional[str], required: bool = False) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if required and not value:
        raise HTTPException(status_code=422, detail="ФИО не может быть пустым")
    return value or None


def _validate_location(db: Session, branch_id: Optional[int], department_id: Optional[int]) -> None:
    if branch_id is not None and not db.get(Branch, branch_id):
        raise HTTPException(status_code=422, detail="Выберите существующий филиал")
    if department_id is not None:
        department = db.get(Department, department_id)
        if not department:
            raise HTTPException(status_code=422, detail="Выберите существующий отдел")
        if branch_id is None or department.branch_id != branch_id:
            raise HTTPException(status_code=422, detail="Отдел не относится к выбранному филиалу")


@router.get("", response_model=List[EmployeeRead])
def list_employees(
    active_only: bool = False,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    query = db.query(Employee).options(joinedload(Employee.branch), joinedload(Employee.department))
    if active_only:
        query = query.filter(Employee.is_active.is_(True))
    return query.order_by(Employee.full_name).all()


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    _validate_location(db, payload.branch_id, payload.department_id)
    employee = Employee(
        full_name=_text(payload.full_name, required=True),
        position=_text(payload.position),
        branch_id=payload.branch_id,
        department_id=payload.department_id,
        phone=_text(payload.phone),
        email=_text(payload.email),
        is_active=payload.is_active,
        notes=_text(payload.notes),
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


@router.put("/{employee_id}", response_model=EmployeeRead)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    data = payload.model_dump(exclude_unset=True)
    if "branch_id" in data and data["branch_id"] != employee.branch_id and "department_id" not in data:
        data["department_id"] = None
    _validate_location(
        db,
        data.get("branch_id", employee.branch_id),
        data.get("department_id", employee.department_id),
    )
    workplace = db.query(Workplace).filter(Workplace.employee_id == employee_id).first()
    if workplace:
        if data.get("is_active") is False:
            raise HTTPException(
                status_code=409,
                detail="Сначала освободите рабочее место сотрудника",
            )
        next_branch_id = data.get("branch_id", employee.branch_id)
        next_department_id = data.get("department_id", employee.department_id)
        if next_branch_id != workplace.branch_id or next_department_id != workplace.department_id:
            raise HTTPException(
                status_code=409,
                detail="Сначала измените филиал или отдел рабочего места сотрудника",
            )
    for field in ("full_name", "position", "phone", "email", "notes"):
        if field in data:
            data[field] = _text(data[field], required=field == "full_name")
    for field, value in data.items():
        setattr(employee, field, value)
    db.commit()
    db.refresh(employee)
    return employee


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    if db.query(Workplace.id).filter(Workplace.employee_id == employee_id).first():
        raise HTTPException(status_code=409, detail="Сотрудник закреплён за рабочим местом")
    db.delete(employee)
    db.commit()
