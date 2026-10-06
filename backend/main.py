from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import SessionLocal, initialize_database
from equipment_history import initialize_equipment_history
from routers import (
    analytics, auth, consumables, devices, employees, history, manufacturers,
    integrations, inventory, orgs, repairs, warehouse, workplaces, digital_documents,
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


# Numbers are entered from physical labels; startup must never regenerate them.
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
app.include_router(digital_documents.router, prefix="/api/digital-documents", tags=["digital-documents"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
