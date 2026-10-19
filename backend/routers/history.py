from datetime import date, datetime, time, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from database import get_db
from equipment_history import event_changes
from models import EquipmentEvent
from natural_sort import compare_natural_text
from routers.auth import get_current_user
from schemas import EquipmentEventPage, EquipmentEventRead


router = APIRouter()
_auth = Depends(get_current_user)


def _sort_expression(key):
    event = EquipmentEvent
    if key == 'category':
        return case({
            'equipment': 'Оборудование', 'device': 'Устройство', 'workplace': 'Рабочее место',
            'repair': 'Ремонт', 'stock': 'Складская операция', 'cartridge': 'Картридж',
        }, value=event.category, else_=event.category)
    if key == 'event':
        return event.title
    if key == 'entity':
        number = func.coalesce(event.inventory_number, '')
        name = func.coalesce(event.entity_name, '')
        return case(((number != '') & (name != ''), number + ' · ' + name), else_=number + name)
    if key == 'direction':
        return case((or_(event.from_value != '', event.to_value != ''),
                     func.coalesce(func.nullif(event.from_value, ''), '—') + ' → ' +
                     func.coalesce(func.nullif(event.to_value, ''), '—')),
                    else_=event.workplace_name)
    return getattr(event, key)


def _read(event: EquipmentEvent) -> EquipmentEventRead:
    return EquipmentEventRead(
        id=event.id,
        occurred_at=event.occurred_at,
        effective_date=event.effective_date,
        category=event.category,
        event_type=event.event_type,
        entity_type=event.entity_type,
        entity_id=event.entity_id,
        reference_type=event.reference_type,
        reference_id=event.reference_id,
        inventory_number=event.inventory_number,
        entity_name=event.entity_name,
        title=event.title,
        details=event.details,
        actor=event.actor,
        branch_name=event.branch_name,
        department_name=event.department_name,
        workplace_name=event.workplace_name,
        employee_name=event.employee_name,
        from_value=event.from_value,
        to_value=event.to_value,
        changes=event_changes(event),
    )


@router.get("", response_model=EquipmentEventPage)
def list_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: Optional[str] = None,
    category: Optional[str] = None,
    event_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    branch_name: Optional[str] = None,
    employee_name: Optional[str] = None,
    entity_search: Optional[str] = None,
    movement_search: Optional[str] = None,
    employee_search: Optional[str] = None,
    actor_search: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort_by: Literal['occurred_at', 'category', 'event', 'entity', 'direction', 'employee_name', 'actor'] = 'occurred_at',
    sort_order: Literal['ascend', 'descend'] = 'descend',
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    query = db.query(EquipmentEvent)
    if category:
        query = query.filter(EquipmentEvent.category == category)
    if event_type:
        query = query.filter(EquipmentEvent.event_type == event_type)
    if entity_type:
        query = query.filter(EquipmentEvent.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(EquipmentEvent.entity_id == entity_id)
    if branch_name:
        query = query.filter(EquipmentEvent.branch_name == branch_name)
    if employee_name:
        query = query.filter(EquipmentEvent.employee_name == employee_name)
    for text, fields in (
        (entity_search, (EquipmentEvent.inventory_number, EquipmentEvent.entity_name)),
        (movement_search, (EquipmentEvent.from_value, EquipmentEvent.to_value, EquipmentEvent.workplace_name)),
        (employee_search, (EquipmentEvent.employee_name,)),
        (actor_search, (EquipmentEvent.actor,)),
    ):
        if text and text.strip():
            # Literal substring matching: '%' and '_' in user input are not wildcards.
            escaped = text.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            query = query.filter(or_(*(field.ilike(f"%{escaped}%", escape='\\') for field in fields)))
    if date_from:
        query = query.filter(EquipmentEvent.occurred_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.filter(EquipmentEvent.occurred_at < datetime.combine(date_to + timedelta(days=1), time.min))
    if search and search.strip():
        value = f"%{search.strip()}%"
        query = query.filter(or_(
            EquipmentEvent.inventory_number.ilike(value),
            EquipmentEvent.entity_name.ilike(value),
            EquipmentEvent.title.ilike(value),
            EquipmentEvent.details.ilike(value),
            EquipmentEvent.workplace_name.ilike(value),
            EquipmentEvent.employee_name.ilike(value),
        ))

    total = query.count()
    expression = _sort_expression(sort_by)
    if sort_by != 'occurred_at':
        # SQLite's built-in NOCASE only understands ASCII. Register a collation
        # on this connection to sort the complete filtered journal before LIMIT.
        if db.get_bind().dialect.name == 'sqlite':
            db.connection().connection.driver_connection.create_collation('NATURAL_RU', compare_natural_text)
            expression = expression.collate('NATURAL_RU')
        else:
            expression = func.lower(expression)
    empty = expression.is_(None) if sort_by == 'occurred_at' else or_(expression.is_(None), func.trim(expression) == '')
    missing = case((empty, 1), else_=0)
    direction = expression.asc() if sort_order == 'ascend' else expression.desc()
    items = (
        query.order_by(missing, direction, EquipmentEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return EquipmentEventPage(total=total, items=[_read(item) for item in items])
