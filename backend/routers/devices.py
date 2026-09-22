from __future__ import annotations

import io
from datetime import date, datetime, timezone
from typing import List, Optional

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from network import normalize_ip_address
from printer_counter import read_counter
from models import Branch, Department, Device, DeviceType, DeviceStatus
from routers.auth import get_current_user
from schemas import DeviceCreate, DeviceUpdate, DeviceRead

router = APIRouter()

_auth = Depends(get_current_user)

# ---------------------------------------------------------------------------
# Справочники для импорта
# ---------------------------------------------------------------------------

_EXPECTED_HEADERS: list[str] = [
    "инв.номер", "серийный номер", "производитель", "модель", "тип",
    "филиал", "отдел", "кабинет", "дата покупки", "гарантия до", "статус", "примечание",
]

_DEVICE_TYPE_MAP: dict[str, DeviceType] = {
    "printer":  DeviceType.printer,
    "принтер":  DeviceType.printer,
    "mfc":      DeviceType.mfc,
    "мфу":      DeviceType.mfc,
    "мфп":      DeviceType.mfc,
    "plotter":  DeviceType.plotter,
    "плоттер":  DeviceType.plotter,
    "scanner":  DeviceType.scanner,
    "сканер":   DeviceType.scanner,
}

_STATUS_MAP: dict[str, DeviceStatus] = {
    "active":           DeviceStatus.active,
    "активен":          DeviceStatus.active,
    "активно":          DeviceStatus.active,
    "активный":         DeviceStatus.active,
    "repair":           DeviceStatus.repair,
    "ремонт":           DeviceStatus.repair,
    "в ремонте":        DeviceStatus.repair,
    "decommissioned":   DeviceStatus.decommissioned,
    "списан":           DeviceStatus.decommissioned,
    "списана":          DeviceStatus.decommissioned,
    "списано":          DeviceStatus.decommissioned,
}


def _parse_date(value) -> Optional[date]:
    """Принимает datetime/date из openpyxl или строку DD.MM.YYYY / YYYY-MM-DD."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _cell(row, idx: int) -> Optional[str]:
    """Возвращает строковое значение ячейки или None."""
    v = row[idx].value
    if v is None:
        return None
    return str(v).strip() or None


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def _get_or_404(db: Session, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def _load_with_relations(db: Session):
    """Базовый запрос с жадной загрузкой Department → Branch."""
    return db.query(Device).options(
        joinedload(Device.department).joinedload(Department.branch)
    )


@router.get("", response_model=List[DeviceRead])
def list_devices(
    branch_id: Optional[int] = None,
    department_id: Optional[int] = None,
    device_type: Optional[DeviceType] = None,
    status: Optional[DeviceStatus] = None,
    manufacturer: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    q = _load_with_relations(db)
    if department_id is not None:
        q = q.filter(Device.department_id == department_id)
    if device_type is not None:
        q = q.filter(Device.device_type == device_type)
    if status is not None:
        q = q.filter(Device.status == status)
    if manufacturer is not None:
        q = q.filter(Device.manufacturer == manufacturer)
    if branch_id is not None:
        q = q.join(Device.department).filter(Department.branch_id == branch_id)
    return q.order_by(Device.inventory_number).all()


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
def create_device(
    payload: DeviceCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if db.query(Device).filter(Device.inventory_number == payload.inventory_number).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Inventory number '{payload.inventory_number}' already exists",
        )
    device = Device(**payload.model_dump())
    db.add(device)
    db.commit()
    db.refresh(device)
    return db.get(Device, device.id)


# ВАЖНО: /import регистрируется ДО /{id}, иначе "import" будет принят как id
@router.post("/import")
def import_devices(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if not file.filename.endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only .xlsx files are supported",
        )

    contents = file.file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot parse xlsx file",
        )

    ws = wb.active
    rows = list(ws.iter_rows())
    if not rows:
        return {"created": 0, "skipped": 0, "errors": []}

    # Валидация заголовков
    header_cells = rows[0]
    actual = [
        str(c.value).strip().lower() if c.value is not None else ""
        for c in header_cells
    ]
    if len(actual) < len(_EXPECTED_HEADERS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Файл содержит {len(actual)} колонок, ожидается {len(_EXPECTED_HEADERS)}. "
                "Используйте шаблон для импорта."
            ),
        )
    mismatched = [
        f"колонка {i + 1}: ожидается «{exp}», получено «{actual[i]}»"
        for i, exp in enumerate(_EXPECTED_HEADERS)
        if actual[i] != exp
    ]
    if mismatched:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Структура файла не соответствует шаблону: " + "; ".join(mismatched),
        )

    # Колонки (0-based):
    # 0 Инв.номер  1 Серийный номер  2 Производитель  3 Модель  4 Тип
    # 5 Филиал     6 Отдел           7 Кабинет         8 Дата покупки
    # 9 Гарантия до  10 Статус       11 Примечание
    data_rows = rows[1:]  # пропускаем заголовок
    ip_column = actual.index("ip-адрес") if "ip-адрес" in actual else None

    created = 0
    skipped = 0
    errors: list[str] = []

    # Кэшируем филиалы и отделы, чтобы не дёргать БД на каждой строке
    branch_cache: dict[str, Optional[int]] = {}
    dept_cache: dict[tuple, Optional[int]] = {}

    for row_num, row in enumerate(data_rows, start=2):
        inv = _cell(row, 0)
        if not inv:
            skipped += 1
            continue

        # Пропускаем дубликаты по инвентарному номеру
        if db.query(Device.id).filter(Device.inventory_number == inv).scalar():
            skipped += 1
            continue

        manufacturer = _cell(row, 2)
        model_name = _cell(row, 3)
        type_raw = _cell(row, 4)

        # Обязательные поля
        missing = [
            name for name, val in [
                ("Производитель", manufacturer),
                ("Модель", model_name),
                ("Тип", type_raw),
            ] if not val
        ]
        if missing:
            errors.append(f"Строка {row_num}: отсутствуют поля {', '.join(missing)}")
            skipped += 1
            continue

        device_type = _DEVICE_TYPE_MAP.get(type_raw.lower())
        if device_type is None:
            errors.append(f"Строка {row_num}: неизвестный тип устройства '{type_raw}'")
            skipped += 1
            continue

        # Статус (необязательный, по умолчанию active)
        status_raw = _cell(row, 10)
        device_status = DeviceStatus.active
        if status_raw:
            device_status = _STATUS_MAP.get(status_raw.lower())
            if device_status is None:
                errors.append(f"Строка {row_num}: неизвестный статус '{status_raw}', установлен 'active'")
                device_status = DeviceStatus.active

        # Филиал
        branch_name = _cell(row, 5)
        department_id: Optional[int] = None
        if branch_name:
            if branch_name not in branch_cache:
                b = db.query(Branch).filter(Branch.name == branch_name).first()
                branch_cache[branch_name] = b.id if b else None
                if not b:
                    errors.append(f"Строка {row_num}: филиал '{branch_name}' не найден, отдел не привязан")
            branch_id_val = branch_cache[branch_name]

            # Отдел
            dept_name = _cell(row, 6)
            if dept_name and branch_id_val is not None:
                key = (dept_name, branch_id_val)
                if key not in dept_cache:
                    d = (
                        db.query(Department)
                        .filter(Department.name == dept_name, Department.branch_id == branch_id_val)
                        .first()
                    )
                    dept_cache[key] = d.id if d else None
                    if not d:
                        errors.append(
                            f"Строка {row_num}: отдел '{dept_name}' в филиале '{branch_name}' не найден"
                        )
                department_id = dept_cache[key]

        try:
            ip_value = normalize_ip_address(_cell(row, ip_column)) if ip_column is not None else None
        except ValueError as exc:
            errors.append(f"Строка {row_num}: {exc}")
            skipped += 1
            continue

        device = Device(
            ip_address=ip_value,
            inventory_number=inv,
            serial_number=_cell(row, 1),
            manufacturer=manufacturer,
            model=model_name,
            device_type=device_type,
            department_id=department_id,
            location=_cell(row, 7),
            purchase_date=_parse_date(row[8].value),
            warranty_until=_parse_date(row[9].value),
            status=device_status,
            notes=_cell(row, 11),
        )
        db.add(device)
        created += 1

    db.commit()
    wb.close()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    device = _load_with_relations(db).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


@router.put("/{device_id}", response_model=DeviceRead)
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    device = _get_or_404(db, device_id)
    data = payload.model_dump(exclude_unset=True)
    if "ip_address" in data and data["ip_address"] != device.ip_address:
        device.page_counter = None
        device.counter_checked_at = None
    if "inventory_number" in data and data["inventory_number"] != device.inventory_number:
        if db.query(Device.id).filter(Device.inventory_number == data["inventory_number"]).scalar():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Inventory number '{data['inventory_number']}' already exists",
            )
    for field, value in data.items():
        setattr(device, field, value)
    db.commit()
    return _load_with_relations(db).filter(Device.id == device_id).first()


@router.post("/{device_id}/counter", response_model=DeviceRead)
def refresh_counter(
    device_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    device = _get_or_404(db, device_id)
    address = device.ip_address
    if not address:
        raise HTTPException(status_code=422, detail="Сначала укажите IP-адрес устройства")
    try:
        counter = read_counter(address)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=502,
            detail="Не удалось прочитать счётчик. Проверьте доступность принтера и поддержку веб-интерфейса Kyocera.",
        ) from exc
    # Do not save a reading if the address was edited during the request.
    updated = db.query(Device).filter(Device.id == device_id, Device.ip_address == address).update({
        Device.page_counter: counter,
        Device.counter_checked_at: datetime.now(timezone.utc).isoformat(),
    }, synchronize_session=False)
    if not updated:
        db.rollback()
        raise HTTPException(status_code=409, detail="Устройство изменилось. Обновите страницу и повторите опрос.")
    db.commit()
    return _load_with_relations(db).filter(Device.id == device_id).first()


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    device = _get_or_404(db, device_id)
    db.delete(device)
    db.commit()
