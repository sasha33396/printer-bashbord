from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from equipment_history import actor_name, add_item_event, changed_values
from models import (
    Branch, Department, Employee, WarehouseItem, Workplace,
    WorkplaceAssetAssignment, WorkplaceStatus,
)
from photo_storage import IMAGE_TYPES, photo_digest, photo_file, photo_files
from routers.auth import get_current_user
from schemas import (
    WorkplaceAssignmentCreate, WorkplaceAssignmentEnd, WorkplaceAssignmentRead,
    WorkplaceAssetBrief, WorkplaceCreate, WorkplacePhotoSelect, WorkplaceRead,
    WorkplaceTransfer, WorkplaceUpdate,
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
        joinedload(Workplace.assignments).joinedload(WorkplaceAssetAssignment.employee),
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
        photo_item_id=workplace.photo_item_id,
        has_photo=bool(workplace.photo_item_id and workplace.photo_hash),
        is_archived=workplace.is_archived,
        archived_at=workplace.archived_at,
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
    return [
        _read(item)
        for item in _query(db)
        .filter(Workplace.is_archived.is_(False))
        .order_by(Workplace.name)
        .all()
    ]


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
            WarehouseItem.is_archived.is_(False),
            ~WarehouseItem.id.in_(assigned_ids),
        )
        .order_by(WarehouseItem.category, WarehouseItem.name)
        .all()
    )


@router.get("/items/{item_id}/assignments", response_model=List[WorkplaceAssignmentRead])
def item_assignment_history(
    item_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if not db.get(WarehouseItem, item_id):
        raise HTTPException(status_code=404, detail="Оборудование не найдено")
    return (
        db.query(WorkplaceAssetAssignment)
        .options(
            joinedload(WorkplaceAssetAssignment.item),
            joinedload(WorkplaceAssetAssignment.employee),
        )
        .filter(WorkplaceAssetAssignment.item_id == item_id)
        .order_by(
            WorkplaceAssetAssignment.assigned_at.desc(),
            WorkplaceAssetAssignment.id.desc(),
        )
        .all()
    )


@router.post("/items/{item_id}/transfer", response_model=WorkplaceAssignmentRead)
def transfer_asset(
    item_id: int,
    payload: WorkplaceTransfer,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    item = db.get(WarehouseItem, item_id)
    if not item or item.tracking_type != "asset" or item.is_archived:
        raise HTTPException(status_code=404, detail="Поштучное оборудование не найдено")
    target = _get(db, payload.workplace_id)
    if target.is_archived:
        raise HTTPException(status_code=409, detail="Нельзя передать оборудование на удалённое рабочее место")
    if target.status == WorkplaceStatus.inactive:
        raise HTTPException(status_code=409, detail="Нельзя передать оборудование на неактивное рабочее место")
    current = (
        db.query(WorkplaceAssetAssignment)
        .options(
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.branch),
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.department),
            joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.employee),
        )
        .filter(
            WorkplaceAssetAssignment.item_id == item.id,
            WorkplaceAssetAssignment.ended_at.is_(None),
        )
        .first()
    )
    if current and current.workplace_id == target.id:
        raise HTTPException(status_code=409, detail="Оборудование уже находится на этом рабочем месте")
    if current and payload.transfer_date < current.assigned_at:
        raise HTTPException(status_code=422, detail="Дата передачи не может быть раньше даты установки")

    source_name = "Склад/серверная"
    if current:
        source_name = current.workplace_name or current.workplace.name
        current.ended_at = payload.transfer_date
        if current.workplace.photo_item_id == item.id:
            _clear_photo(current.workplace)

    assignment = _new_assignment(target, item, payload.transfer_date, payload.notes)
    item.branch_id = target.branch_id
    item.department_id = target.department_id
    item.placement = "Рабочее место"
    if item.condition == "На складе":
        item.condition = "Рабочий"
    db.add(assignment)
    add_item_event(
        db,
        item,
        workplace=target,
        employee=target.employee,
        category="workplace",
        event_type="transferred" if current else "assigned_to_workplace",
        title="Оборудование передано на другое рабочее место" if current else "Оборудование установлено на рабочее место",
        actor=actor_name(current_user),
        effective_date=payload.transfer_date,
        from_value=source_name,
        to_value=target.name,
        details=payload.notes,
    )
    db.commit()
    db.refresh(assignment)
    return assignment


@router.get("/{workplace_id}", response_model=WorkplaceRead)
def get_workplace(workplace_id: int, db: Session = Depends(get_db), _: dict = _auth):
    return _read(_get(db, workplace_id))


def _selected_photo(db: Session, workplace: Workplace):
    if not workplace.photo_item_id or not workplace.photo_hash:
        return None
    assignment = db.query(WorkplaceAssetAssignment.id).filter(
        WorkplaceAssetAssignment.workplace_id == workplace.id,
        WorkplaceAssetAssignment.item_id == workplace.photo_item_id,
        WorkplaceAssetAssignment.ended_at.is_(None),
    ).first()
    item = db.get(WarehouseItem, workplace.photo_item_id)
    if not assignment or not item or not item.inventory_number:
        return None
    for path in photo_files(item.inventory_number):
        if photo_digest(path) == workplace.photo_hash:
            return path
    return None


def _clear_photo(workplace: Workplace) -> None:
    workplace.photo_item_id = None
    workplace.photo_hash = None


def _new_assignment(
    workplace: Workplace,
    item: WarehouseItem,
    assigned_at: date,
    notes: Optional[str] = None,
) -> WorkplaceAssetAssignment:
    return WorkplaceAssetAssignment(
        workplace_id=workplace.id,
        item_id=item.id,
        assigned_at=assigned_at,
        notes=_text(notes),
        employee_id=workplace.employee_id,
        employee_name=workplace.employee.full_name if workplace.employee else None,
        inventory_number=item.inventory_number,
        item_name=item.name,
        item_category=item.category,
        workplace_name=workplace.name,
        branch_name=workplace.branch.name if workplace.branch else None,
        department_name=workplace.department.name if workplace.department else None,
    )


@router.get("/{workplace_id}/photo")
def get_workplace_photo(
    workplace_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    workplace = _get(db, workplace_id)
    if workplace.is_archived:
        raise HTTPException(status_code=409, detail="Рабочее место удалено")
    path = _selected_photo(db, workplace)
    if not path:
        if workplace.photo_item_id or workplace.photo_hash:
            _clear_photo(workplace)
            db.commit()
        raise HTTPException(status_code=404, detail="Фото рабочего места не найдено")
    return FileResponse(
        path,
        media_type=IMAGE_TYPES[path.suffix.lower()],
        headers={"Cache-Control": "private, no-cache"},
    )


@router.put("/{workplace_id}/photo", response_model=WorkplaceRead)
def select_workplace_photo(
    workplace_id: int,
    payload: WorkplacePhotoSelect,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    workplace = _get(db, workplace_id)
    assignment = db.query(WorkplaceAssetAssignment.id).filter(
        WorkplaceAssetAssignment.workplace_id == workplace.id,
        WorkplaceAssetAssignment.item_id == payload.item_id,
        WorkplaceAssetAssignment.ended_at.is_(None),
    ).first()
    if not assignment:
        raise HTTPException(status_code=422, detail="Оборудование не закреплено за этим рабочим местом")
    item = db.get(WarehouseItem, payload.item_id)
    if not item or not item.inventory_number:
        raise HTTPException(status_code=422, detail="У оборудования нет инвентарного номера")
    try:
        path = photo_file(item.inventory_number, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Фотография не найдена") from exc
    if not path.is_file() or path.is_symlink():
        raise HTTPException(status_code=404, detail="Фотография не найдена")
    workplace.photo_item_id = item.id
    workplace.photo_hash = photo_digest(path)
    db.commit()
    return _read(_get(db, workplace.id))


@router.delete("/{workplace_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def clear_workplace_photo(
    workplace_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    workplace = _get(db, workplace_id)
    _clear_photo(workplace)
    db.commit()


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
    current_user: dict = _auth,
):
    workplace = _get(db, workplace_id)
    if workplace.is_archived:
        raise HTTPException(status_code=409, detail="Рабочее место удалено")
    data = payload.model_dump(exclude_unset=True)
    old_context = {
        "name": workplace.name,
        "branch_id": workplace.branch_id,
        "department_id": workplace.department_id,
        "employee_id": workplace.employee_id,
        "employee_name": workplace.employee.full_name if workplace.employee else None,
    }
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
    db.flush()
    db.expire(workplace, ["branch", "department", "employee"])
    context_changed = any(
        old_context[field] != getattr(workplace, field)
        for field in ("name", "branch_id", "department_id", "employee_id")
    )
    for assignment in list(workplace.assignments):
        if assignment.ended_at is None:
            assignment.item.branch_id = branch_id
            assignment.item.department_id = department_id
            if context_changed:
                assignment.ended_at = date.today()
                replacement = _new_assignment(
                    workplace,
                    assignment.item,
                    date.today(),
                    "Продолжение закрепления после изменения рабочего места",
                )
                db.add(replacement)
                employee_changed = old_context["employee_id"] != workplace.employee_id
                add_item_event(
                    db,
                    assignment.item,
                    workplace=workplace,
                    employee=workplace.employee,
                    category="workplace",
                    event_type="responsible_changed" if employee_changed else "workplace_updated",
                    title="Изменено ответственное лицо" if employee_changed else "Изменены данные рабочего места",
                    actor=actor_name(current_user),
                    effective_date=date.today(),
                    from_value=old_context["employee_name"] if employee_changed else old_context["name"],
                    to_value=(workplace.employee.full_name if workplace.employee else "Не назначен")
                    if employee_changed else workplace.name,
                    changes=changed_values(old_context, {
                        "name": workplace.name,
                        "branch_id": workplace.branch_id,
                        "department_id": workplace.department_id,
                        "employee_id": workplace.employee_id,
                        "employee_name": workplace.employee.full_name if workplace.employee else None,
                    }),
                )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Рабочее место с таким названием уже есть в филиале") from exc
    return _read(_get(db, workplace.id))


@router.delete("/{workplace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workplace(workplace_id: int, db: Session = Depends(get_db), _: dict = _auth):
    workplace = _get(db, workplace_id)
    if workplace.is_archived:
        raise HTTPException(status_code=409, detail="Рабочее место уже удалено")
    if any(assignment.ended_at is None for assignment in workplace.assignments):
        raise HTTPException(status_code=409, detail="Сначала снимите или передайте оборудование с рабочего места")
    workplace.is_archived = True
    workplace.archived_at = datetime.now(timezone.utc)
    workplace.employee_id = None
    workplace.status = WorkplaceStatus.inactive
    _clear_photo(workplace)
    db.commit()


@router.post("/{workplace_id}/assignments", response_model=WorkplaceAssignmentRead, status_code=status.HTTP_201_CREATED)
def assign_asset(
    workplace_id: int,
    payload: WorkplaceAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    workplace = _get(db, workplace_id)
    if workplace.is_archived:
        raise HTTPException(status_code=409, detail="Рабочее место удалено")
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
    assignment = _new_assignment(workplace, item, payload.assigned_at, payload.notes)
    item.branch_id = workplace.branch_id
    item.department_id = workplace.department_id
    item.placement = "Рабочее место"
    if item.condition == "На складе":
        item.condition = "Рабочий"
    db.add(assignment)
    add_item_event(
        db,
        item,
        workplace=workplace,
        employee=workplace.employee,
        category="workplace",
        event_type="assigned_to_workplace",
        title="Оборудование установлено на рабочее место",
        actor=actor_name(current_user),
        effective_date=payload.assigned_at,
        from_value="Склад/серверная",
        to_value=workplace.name,
        details=payload.notes,
    )
    db.commit()
    db.refresh(assignment)
    return assignment


@router.post("/assignments/{assignment_id}/end", response_model=WorkplaceAssignmentRead)
def end_assignment(
    assignment_id: int,
    payload: WorkplaceAssignmentEnd,
    db: Session = Depends(get_db),
    current_user: dict = _auth,
):
    assignment = db.query(WorkplaceAssetAssignment).options(
        joinedload(WorkplaceAssetAssignment.item),
        joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.branch),
        joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.department),
        joinedload(WorkplaceAssetAssignment.workplace).joinedload(Workplace.employee),
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
    workplace = db.get(Workplace, assignment.workplace_id)
    if workplace and workplace.photo_item_id == assignment.item_id:
        _clear_photo(workplace)
    add_item_event(
        db,
        assignment.item,
        workplace=assignment.workplace,
        employee=assignment.employee or assignment.workplace.employee,
        category="workplace",
        event_type="returned_to_stock",
        title="Оборудование снято с рабочего места",
        actor=actor_name(current_user),
        effective_date=payload.ended_at,
        from_value=assignment.workplace_name or assignment.workplace.name,
        to_value="Склад/серверная",
        details=payload.notes or assignment.notes,
    )
    db.commit()
    db.refresh(assignment)
    return assignment
