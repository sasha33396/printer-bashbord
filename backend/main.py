from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import SessionLocal, initialize_database
from equipment_history import initialize_equipment_history
from inventory_numbers import inventory_number_lock, migrate_inventory_numbers
from models import WarehouseItem
from photo_storage import move_photo_directory
from routers import (
    analytics, auth, consumables, devices, employees, history, manufacturers,
    integrations, inventory, orgs, repairs, warehouse, workplaces,
)

initialize_database()


def migrate_repair_counter_deltas() -> None:
    db = SessionLocal()
    try:
        repairs.recalculate_all_repair_deltas(db)
    finally:
        db.close()


def migrate_equipment_history() -> None:
    db = SessionLocal()
    try:
        initialize_equipment_history(db)
    finally:
        db.close()


def migrate_existing_inventory_numbers() -> None:
    db = SessionLocal()
    moved_directories: list[tuple[str, str]] = []
    try:
        with inventory_number_lock:
            changes = migrate_inventory_numbers(db)
            warehouse_numbers = {
                item.inventory_number for item in db.query(WarehouseItem).all()
                if item.inventory_number
            }
            for entity_type, _, old_value, new_value in changes:
                if entity_type != "warehouse_item" or not old_value:
                    continue
                # При старых дублях один каталог нельзя однозначно отнести ко второй
                # карточке. Оставляем его у карточки, сохранившей исходный номер.
                if old_value in warehouse_numbers:
                    continue
                if move_photo_directory(old_value, new_value):
                    moved_directories.append((old_value, new_value))
            db.commit()
    except Exception:
        db.rollback()
        for old_value, new_value in reversed(moved_directories):
            move_photo_directory(new_value, old_value)
        raise
    finally:
        db.close()


migrate_existing_inventory_numbers()
migrate_repair_counter_deltas()
migrate_equipment_history()

app = FastAPI(title="Printer Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(orgs.router, prefix="/api/orgs", tags=["orgs"])
app.include_router(devices.router, prefix="/api/devices", tags=["devices"])
app.include_router(repairs.router, prefix="/api/repairs", tags=["repairs"])
app.include_router(consumables.router, prefix="/api/consumables", tags=["consumables"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(manufacturers.router, prefix="/api/manufacturers", tags=["manufacturers"])
app.include_router(warehouse.router, prefix="/api/warehouse", tags=["warehouse"])
app.include_router(employees.router, prefix="/api/employees", tags=["employees"])
app.include_router(workplaces.router, prefix="/api/workplaces", tags=["workplaces"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["inventory"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
