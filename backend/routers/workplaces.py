from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import (
    Branch, Department, Employee, WarehouseItem, Workplace,
    WorkplaceAssetAssignment, WorkplaceStatus,
)
from routers.auth import get_current_user
from schemas import (
    WorkplaceAssignmentCreate, WorkplaceAssignmentEnd, WorkplaceAssignmentRead,
    WorkplaceAssetBrief, WorkplaceCreate, WorkplaceRead, WorkplaceUpdate,
)

router = APIRouter()
_auth = Depends(get_current_user)


def _text(value: Optional[str], required: bool = False) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if required and not value:
        raise HTTPException(status_code=422, detail="Название рабочего места не может быть пустым")
    return value or None


def _query(db: Session):
    return db.query(Workplace).options(
        joinedload(Workplace.branch),
        joinedload(Workplace.department),
        joinedload(Workplace.employee).joinedload(Employee.branch),
        joinedload(Workplace.employee).joinedload(Employee.department),
        joinedload(Workplace.assignments).joinedload(WorkplaceAssetAssignment.item),
    )


def _get(db: Session, workplace_id: int) -> Workplace:
    workplace = _query(db).filter(Workplace.id == workplace_id).first()
    if not workplace:
        raise HTTPException(status_code=404, detail="Рабочее место не найдено")
    return workplace


def _read(workplace: Workplace) -> WorkplaceRead:
    current = [assignment for assignment in workplace.assignments if assignment.ended_at is None]
    return WorkplaceRead(
        id=workplace.id,
        name=workplace.name,
        branch_id=workplace.branch_id,
        department_id=workplace.department_id,
        employee_id=workplace.employee_id,
        branch=workplace.branch,
        department=workplace.department,
        employee=workplace.employee,
        location=workplace.location,
        status=workplace.status,
        notes=workplace.notes,
        current_assets=current,
        assignment_history=workplace.assignments,
    )


def _validate_location(db: Session, branch_id: Optional[int], department_id: Optional[int]) -> None:
    if branch_id is None or not db.get(Branch, branch_id):
        raise HTTPException(status_code=422, detail="Выберите существующий филиал")
    if department_id is not None:
        department = db.get(Department, department_id)
        if not department or department.branch_id != branch_id:
            raise HTTPException(status_code=422, detail="Отдел не относится к выбранному филиалу")


def _validate_employee(
    db: Session,
    employee_id: Optional[int],
    branch_id: int,
    department_id: Optional[int],
    exclude_workplace_id: Optional[int] = None,
) -> Optional[Employee]:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if not employee or not employee.is_active:
        raise HTTPException(status_code=422, detail="Выберите активного сотрудника")
    if employee.branch_id is not None and employee.branch_id != branch_id:
        raise HTTPException(status_code=422, detail="Сотрудник относится к другому филиалу")
    if department_id is not None and employee.department_id is not None and employee.department_id != department_id:
        raise HTTPException(status_code=422, detail="Сотрудник относится к другому отделу")
    query = db.query(Workplace.id).filter(Workplace.employee_id == employee_id)
    if exclude_workplace_id is not None:
        query = query.filter(Workplace.id != exclude_workplace_id)
    if query.first():
        raise HTTPException(status_code=409, detail="Сотрудник уже закреплён за другим рабочим местом")
    return employee


def _actual_status(value: WorkplaceStatus, employee_id: Optional[int]) -> WorkplaceStatus:
    if value == WorkplaceStatus.inactive:
        return value
    return WorkplaceStatus.occupied if employee_id is not None else WorkplaceStatus.vacant


@router.get("", response_model=List[WorkplaceRead])
def list_workplaces(db: Session = Depends(get_db), _: dict = _auth):
    return [_read(item) for item in _query(db).order_by(Workplace.name).all()]


@router.get("/available-assets", response_model=List[WorkplaceAssetBrief])
def available_assets(db: Session = Depends(get_db), _: dict = _auth):
    assigned_ids = db.query(WorkplaceAssetAssignment.item_id).filter(
        WorkplaceAssetAssignment.ended_at.is_(None)
    )
    return (
        db.query(WarehouseItem)
        .filter(
            WarehouseItem.tracking_type == "asset",
            WarehouseItem.condition != "Списан",
            ~WarehouseItem.id.in_(assigned_ids),
        )
        .order_by(WarehouseItem.category, WarehouseItem.name)
        .all()
    )


@router.get("/{workplace_id}", response_model=WorkplaceRead)
def get_workplace(workplace_id: int, db: Session = Depends(get_db), _: dict = _auth):
    return _read(_get(db, workplace_id))


@router.post("", response_model=WorkplaceRead, status_code=status.HTTP_201_CREATED)
def create_workplace(
    payload: WorkplaceCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    _validate_location(db, payload.branch_id, payload.department_id)
    _validate_employee(db, payload.employee_id, payload.branch_id, payload.department_id)
    workplace = Workplace(
        name=_text(payload.name, required=True),
        branch_id=payload.branch_id,
        department_id=payload.department_id,
        location=_text(payload.location),
        employee_id=payload.employee_id,
        status=_actual_status(payload.status, payload.employee_id),
        notes=_text(payload.notes),
    )
    db.add(workplace)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Рабочее место с таким названием уже есть в филиале") from exc
    return _read(_get(db, workplace.id))


@router.put("/{workplace_id}", response_model=WorkplaceRead)
def update_workplace(
    workplace_id: int,
    payload: WorkplaceUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    workplace = _get(db, workplace_id)
    data = payload.model_dump(exclude_unset=True)
    if "branch_id" in data and data["branch_id"] != workplace.branch_id and "department_id" not in data:
        data["department_id"] = None
    branch_id = data.get("branch_id", workplace.branch_id)
    department_id = data.get("department_id", workplace.department_id)
    employee_id = data.get("employee_id", workplace.employee_id)
    _validate_location(db, branch_id, department_id)
    _validate_employee(db, employee_id, branch_id, department_id, exclude_workplace_id=workplace.id)
    for field in ("name", "location", "notes"):
        if field in data:
            data[field] = _text(data[field], required=field == "name")
    requested_status = data.get("status", workplace.status)
    data["status"] = _actual_status(requested_status, employee_id)
    for field, value in data.items():
        setattr(workplace, field, value)
    for assignment in workplace.assignments:
        if assignment.ended_at is None:
            assignment.item.branch_id = branch_id
            assignment.item.department_id = department_id
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Рабочее место с таким названием уже есть в филиале") from exc
    return _read(_get(db, workplace.id))


@router.delete("/{workplace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workplace(workplace_id: int, db: Session = Depends(get_db), _: dict = _auth):
    workplace = _get(db, workplace_id)
    if workplace.assignments:
        raise HTTPException(status_code=409, detail="Нельзя удалить рабочее место с историей оборудования")
    db.delete(workplace)
    db.commit()


@router.post("/{workplace_id}/assignments", response_model=WorkplaceAssignmentRead, status_code=status.HTTP_201_CREATED)
def assign_asset(
    workplace_id: int,
    payload: WorkplaceAssignmentCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    workplace = _get(db, workplace_id)
    if workplace.status == WorkplaceStatus.inactive:
        raise HTTPException(
            status_code=409,
            detail="Нельзя добавить оборудование на неактивное рабочее место",
        )
    item = db.get(WarehouseItem, payload.item_id)
    if not item or item.tracking_type != "asset":
        raise HTTPException(status_code=422, detail="Выберите оборудование с поштучным учётом")
    existing = db.query(WorkplaceAssetAssignment).filter(
        WorkplaceAssetAssignment.item_id == item.id,
        WorkplaceAssetAssignment.ended_at.is_(None),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Оборудование уже закреплено за рабочим местом")
    assignment = WorkplaceAssetAssignment(
        workplace_id=workplace.id,
        item_id=item.id,
        assigned_at=payload.assigned_at,
        notes=_text(payload.notes),
    )
    item.branch_id = workplace.branch_id
    item.department_id = workplace.department_id
    item.placement = "Рабочее место"
    if item.condition == "На складе":
        item.condition = "Рабочий"
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


@router.post("/assignments/{assignment_id}/end", response_model=WorkplaceAssignmentRead)
def end_assignment(
    assignment_id: int,
    payload: WorkplaceAssignmentEnd,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    assignment = db.query(WorkplaceAssetAssignment).options(
        joinedload(WorkplaceAssetAssignment.item)
    ).filter(WorkplaceAssetAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    if assignment.ended_at is not None:
        raise HTTPException(status_code=409, detail="Оборудование уже снято с рабочего места")
    if payload.ended_at < assignment.assigned_at:
        raise HTTPException(status_code=422, detail="Дата снятия не может быть раньше даты установки")
    assignment.ended_at = payload.ended_at
    if payload.notes:
        assignment.notes = _text(payload.notes)
    assignment.item.placement = "Склад/серверная"
    assignment.item.condition = "На складе"
    db.commit()
    db.refresh(assignment)
    return assignment
