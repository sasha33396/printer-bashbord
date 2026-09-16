from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from routers import auth, orgs, devices, repairs, consumables, analytics, manufacturers

Base.metadata.create_all(bind=engine)

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
