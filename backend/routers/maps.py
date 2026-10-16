import json
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from map_schemas import BuildingInput, FloorInput, FloorSave
from models import (Cartridge, Department, Device, DeviceStatus, Employee, MapBuilding, MapFloor,
                    MapMarker, WarehouseItem, Workplace, WorkplaceAssetAssignment, Branch)
import photo_storage
from routers.auth import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])
MAX_BACKGROUND_BYTES = 10 * 1024 * 1024


def _floor(db, floor_id):
    floor = db.get(MapFloor, floor_id)
    if not floor:
        raise HTTPException(404, "Этаж не найден")
    return floor


def _building(db, building_id):
    building = db.get(MapBuilding, building_id)
    if not building:
        raise HTTPException(404, "Здание не найдено")
    return building


def _conflict():
    raise HTTPException(409, "План изменён другим пользователем. Ваш рисунок сохранён в редакторе; обновите план перед повторным сохранением.")


def _background_path(filename):
    if not re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp)", filename):
        raise HTTPException(404, "Подложка не найдена")
    root = (photo_storage.PHOTO_ROOT / "_map_backgrounds").resolve()
    if root.parent != photo_storage.PHOTO_ROOT.resolve():
        raise HTTPException(409, "Недоступен каталог подложек")
    return root / filename


def _remove_background(filename):
    if filename:
        _background_path(filename).unlink(missing_ok=True)


def _catalog(db):
    """Resolve labels live; placements never copy employee or equipment records."""
    records = {}
    assignments = db.query(WorkplaceAssetAssignment).filter(WorkplaceAssetAssignment.ended_at.is_(None)).all()
    parents = {("warehouse_item", row.item_id): ("workplace", row.workplace_id) for row in assignments}
    for row in db.query(Cartridge).filter(Cartridge.device_id.isnot(None)).all():
        parents[("warehouse_item", row.item_id)] = ("device", row.device_id)
    workplace_assets = {}
    items = db.query(WarehouseItem).options(joinedload(WarehouseItem.branch), joinedload(WarehouseItem.department)).all()
    for item in items:
        records[("warehouse_item", item.id)] = {
            "entity_type": "warehouse_item", "entity_id": item.id, "name": item.name,
            "inventory_number": item.inventory_number, "category": item.category, "status": item.condition,
            "branch_id": item.branch_id, "branch_name": item.branch.name if item.branch else None,
            "department_name": item.department.name if item.department else None,
            "employee_name": None, "available": item.tracking_type == "asset" and not item.is_archived,
            "path": f"/warehouse/items/{item.id}", "equipment": [],
        }
    for assignment in assignments:
        item = records.get(("warehouse_item", assignment.item_id))
        if item:
            workplace_assets.setdefault(assignment.workplace_id, []).append({
                "id": item["entity_id"], "name": item["name"], "inventory_number": item["inventory_number"], "path": item["path"],
            })
    workplaces = db.query(Workplace).options(joinedload(Workplace.branch), joinedload(Workplace.department), joinedload(Workplace.employee)).all()
    for workplace in workplaces:
        records[("workplace", workplace.id)] = {
            "entity_type": "workplace", "entity_id": workplace.id, "name": workplace.name,
            "inventory_number": None, "category": "Рабочее место", "status": workplace.status.value,
            "branch_id": workplace.branch_id, "branch_name": workplace.branch.name if workplace.branch else None,
            "department_name": workplace.department.name if workplace.department else None,
            "employee_name": workplace.employee.full_name if workplace.employee else None,
            "available": not workplace.is_archived,
            "path": f"/workplaces/{workplace.id}", "equipment": workplace_assets.get(workplace.id, []),
        }
    devices = db.query(Device).options(joinedload(Device.department).joinedload(Department.branch)).all()
    for device in devices:
        department = device.department
        records[("device", device.id)] = {
            "entity_type": "device", "entity_id": device.id, "name": f"{device.manufacturer} {device.model}",
            "inventory_number": device.inventory_number, "category": "Печатающая техника", "status": device.status.value,
            "branch_id": department.branch_id if department else None,
            "branch_name": department.branch.name if department and department.branch else None,
            "department_name": department.name if department else None, "employee_name": None,
            "available": device.status != DeviceStatus.decommissioned, "path": f"/devices/{device.id}", "equipment": [],
        }
    return records, parents


def _positions(db):
    result = {}
    rows = db.query(MapMarker).options(joinedload(MapMarker.floor).joinedload(MapFloor.building)).all()
    for marker in rows:
        floor = marker.floor
        result[(marker.entity_type, marker.entity_id)] = {
            "floor_id": floor.id, "floor_name": floor.name, "revision": floor.revision,
            "building_name": floor.building.name, "building_id": floor.building_id,
            "x": marker.x, "y": marker.y, "entity_type": marker.entity_type, "entity_id": marker.entity_id,
            "path": f"/maps?floor={floor.id}&focus={marker.entity_type}:{marker.entity_id}",
        }
    return result


def _position(key, positions, parents):
    direct = positions.get(key)
    if direct:
        return {**direct, "inherited": False}
    parent = parents.get(key)
    if parent and parent in positions:
        return {**positions[parent], "inherited": True}
    return None


def _read_floor(db, floor):
    catalog, _ = _catalog(db)
    markers = db.query(MapMarker).filter(MapMarker.floor_id == floor.id).order_by(MapMarker.id).all()
    def marker_entity(marker):
        entity = dict(catalog.get((marker.entity_type, marker.entity_id), {
            "name": marker.entity_name, "available": False, "path": None,
            "category": "Объект удалён", "equipment": [],
        }))
        if (entity.get("available") and floor.building.branch_id is not None
                and entity.get("branch_id") not in (None, floor.building.branch_id)):
            entity["placement_warning"] = "Филиал объекта изменился. Перенесите или снимите отметку с этого плана."
        return entity
    return {
        "id": floor.id, "building_id": floor.building_id, "building_name": floor.building.name,
        "branch_id": floor.building.branch_id, "name": floor.name, "width": floor.width, "height": floor.height,
        "revision": floor.revision, "updated_at": floor.updated_at, "updated_by": floor.updated_by,
        "shapes": json.loads(floor.shapes_json), "has_background": bool(floor.background_filename),
        "background_opacity": floor.background_opacity,
        "markers": [{"entity_type": marker.entity_type, "entity_id": marker.entity_id, "x": marker.x,
                     "y": marker.y, "rotation": marker.rotation,
                     "entity": marker_entity(marker)} for marker in markers],
    }


@router.get("/buildings")
def buildings(db: Session = Depends(get_db)):
    floors = db.query(MapFloor).order_by(MapFloor.id).all()
    return [{"id": building.id, "name": building.name, "address": building.address, "branch_id": building.branch_id,
             "branch_name": building.branch.name if building.branch else None,
             "floors": [{"id": floor.id, "name": floor.name, "revision": floor.revision} for floor in floors if floor.building_id == building.id]}
            for building in db.query(MapBuilding).options(joinedload(MapBuilding.branch)).order_by(MapBuilding.name).all()]


@router.post("/buildings", status_code=201)
def create_building(payload: BuildingInput, db: Session = Depends(get_db)):
    if payload.branch_id is not None and not db.get(Branch, payload.branch_id):
        raise HTTPException(422, "Филиал не найден")
    building = MapBuilding(**payload.model_dump())
    db.add(building)
    db.commit()
    return {"id": building.id, **payload.model_dump()}


@router.put("/buildings/{building_id}")
def update_building(building_id: int, payload: BuildingInput, db: Session = Depends(get_db)):
    building = _building(db, building_id)
    if payload.branch_id is not None and not db.get(Branch, payload.branch_id):
        raise HTTPException(422, "Филиал не найден")
    if payload.branch_id != building.branch_id and db.query(MapMarker).join(MapFloor).filter(MapFloor.building_id == building.id).first():
        raise HTTPException(409, "Сначала снимите объекты с планов перед сменой филиала здания")
    for key, value in payload.model_dump().items():
        setattr(building, key, value)
    db.commit()
    return {"id": building.id, **payload.model_dump()}


@router.delete("/buildings/{building_id}", status_code=204)
def delete_building(building_id: int, db: Session = Depends(get_db)):
    building = _building(db, building_id)
    if db.query(MapFloor.id).filter(MapFloor.building_id == building_id).first():
        raise HTTPException(409, "Сначала удалите планы этажей здания")
    db.delete(building)
    db.commit()


@router.post("/buildings/{building_id}/floors", status_code=201)
def create_floor(building_id: int, payload: FloorInput, db: Session = Depends(get_db), actor: dict = Depends(get_current_user)):
    _building(db, building_id)
    floor = MapFloor(building_id=building_id, **payload.model_dump(), updated_by=actor["username"])
    db.add(floor)
    db.commit()
    return _read_floor(db, floor)


@router.get("/catalog")
def catalog(db: Session = Depends(get_db)):
    entities, parents = _catalog(db)
    positions = _positions(db)
    return [{**entity, "position": _position(key, positions, parents)} for key, entity in entities.items() if entity["available"]]


@router.get("/locate/{entity_type}/{entity_id}")
def locate(entity_type: str, entity_id: int, db: Session = Depends(get_db)):
    entities, parents = _catalog(db)
    if entity_type == "employee":
        if not db.get(Employee, entity_id):
            raise HTTPException(404, "Сотрудник не найден")
        workplace = db.query(Workplace).filter(Workplace.employee_id == entity_id, Workplace.is_archived.is_(False)).first()
        key = ("workplace", workplace.id) if workplace else None
    else:
        key = (entity_type, entity_id)
        if key not in entities:
            raise HTTPException(404, "Объект не найден")
    position = _position(key, _positions(db), parents) if key else None
    return {"placed": bool(position), "position": position}


@router.get("/floors/{floor_id}")
def get_floor(floor_id: int, db: Session = Depends(get_db)):
    return _read_floor(db, _floor(db, floor_id))


@router.get("/floors/{floor_id}/background")
def get_background(floor_id: int, db: Session = Depends(get_db)):
    floor = _floor(db, floor_id)
    if not floor.background_filename:
        raise HTTPException(404, "Подложка не загружена")
    path = _background_path(floor.background_filename)
    if not path.is_file():
        raise HTTPException(404, "Файл подложки не найден")
    return FileResponse(path, media_type=photo_storage.IMAGE_TYPES[path.suffix], headers={"Cache-Control": "no-store"})


@router.put("/floors/{floor_id}")
async def save_floor(floor_id: int, document: str = Form(...), file: UploadFile | None = File(default=None),
                     db: Session = Depends(get_db), actor: dict = Depends(get_current_user)):
    if len(document.encode("utf-8")) > 2 * 1024 * 1024:
        raise HTTPException(413, "Слишком много данных плана")
    try:
        payload = FloorSave.model_validate_json(document)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    floor = _floor(db, floor_id)
    old_background = floor.background_filename
    new_background = None
    committed = False
    try:
        if file:
            content = await file.read(MAX_BACKGROUND_BYTES + 1)
            if len(content) > MAX_BACKGROUND_BYTES:
                raise HTTPException(413, "Подложка должна быть не больше 10 МБ")
            extension = photo_storage.image_extension(content[:32])
            if extension is None:
                raise HTTPException(422, "Поддерживаются изображения JPEG, PNG и WebP")
            new_background = uuid4().hex + extension
            path = _background_path(new_background)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        updated = db.query(MapFloor).filter(MapFloor.id == floor_id, MapFloor.revision == payload.revision).update({
            MapFloor.name: payload.name, MapFloor.width: payload.width, MapFloor.height: payload.height,
            MapFloor.shapes_json: json.dumps([shape.model_dump(exclude_none=True) for shape in payload.shapes], ensure_ascii=False),
            MapFloor.background_opacity: payload.background_opacity,
            MapFloor.background_filename: new_background or (None if payload.remove_background else old_background),
            MapFloor.revision: payload.revision + 1, MapFloor.updated_at: datetime.now(timezone.utc), MapFloor.updated_by: actor["username"],
        }, synchronize_session=False)
        if not updated:
            _conflict()
        entities, _ = _catalog(db)
        existing = {(row.entity_type, row.entity_id): row for row in db.query(MapMarker).all()}
        desired = {(row.entity_type, row.entity_id) for row in payload.markers}
        transfers = {}
        for marker in payload.markers:
            key = (marker.entity_type, marker.entity_id)
            entity = entities.get(key)
            previous = existing.get(key)
            if not entity or not entity["available"]:
                if previous is None or previous.floor_id != floor_id:
                    raise HTTPException(422, "Нельзя разместить удалённый, архивный или количественный объект")
            elif floor.building.branch_id is not None and entity["branch_id"] not in (None, floor.building.branch_id):
                raise HTTPException(422, f"Объект «{entity['name']}» относится к другому филиалу")
            if previous and previous.floor_id != floor_id:
                if (marker.from_floor_id, marker.from_revision) != (previous.floor_id, previous.floor.revision):
                    raise HTTPException(409, "Объект уже размещён на другом этаже. Подтвердите перенос по актуальному плану.")
                transfers[previous.floor_id] = marker.from_revision
        for source_id, revision in sorted(transfers.items()):
            changed = db.query(MapFloor).filter(MapFloor.id == source_id, MapFloor.revision == revision).update({
                MapFloor.revision: revision + 1, MapFloor.updated_at: datetime.now(timezone.utc), MapFloor.updated_by: actor["username"],
            }, synchronize_session=False)
            if not changed:
                _conflict()
        for key, marker in existing.items():
            if marker.floor_id == floor_id and key not in desired:
                db.delete(marker)
        for marker in payload.markers:
            key = (marker.entity_type, marker.entity_id)
            row = existing.get(key)
            if row is None:
                row = MapMarker(entity_type=marker.entity_type, entity_id=marker.entity_id)
                db.add(row)
            row.floor_id = floor_id
            row.entity_name = entities.get(key, {}).get("name", row.entity_name or "Удалённый объект")
            row.x, row.y, row.rotation = marker.x, marker.y, marker.rotation
        db.commit()
        committed = True
        if old_background and (new_background or payload.remove_background):
            _remove_background(old_background)
        return _read_floor(db, floor)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Объект уже размещён другим пользователем. Обновите план.") from exc
    finally:
        if not committed:
            db.rollback()
            _remove_background(new_background)
        if file:
            await file.close()


@router.delete("/floors/{floor_id}", status_code=204)
def delete_floor(floor_id: int, revision: int = Query(ge=1), db: Session = Depends(get_db)):
    floor = _floor(db, floor_id)
    background = floor.background_filename
    # Acquire the write transaction and check the editor's version before removing markers.
    if not db.query(MapFloor).filter(MapFloor.id == floor_id, MapFloor.revision == revision).update({MapFloor.revision: revision + 1}):
        _conflict()
    db.query(MapMarker).filter(MapMarker.floor_id == floor_id).delete(synchronize_session=False)
    db.query(MapFloor).filter(MapFloor.id == floor_id).delete(synchronize_session=False)
    db.commit()
    _remove_background(background)
