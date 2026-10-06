import os
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from import_schemas import OcsAdImportRequest, OcsAdImportResponse
from models import OcsImportRun
from ocs_ad_import import import_ocs_ad
from routers.auth import get_current_user, oauth2_scheme


router = APIRouter()


def get_import_user(token: str = Depends(oauth2_scheme)):
    import_token = os.getenv("OCS_AD_IMPORT_TOKEN", "")
    if import_token and secrets.compare_digest(token.encode(), import_token.encode()):
        return {"username": "integration:ocs-ad"}
    return get_current_user(token)


@router.post("/ocs-ad/import", response_model=OcsAdImportResponse)
def import_inventory(
    payload: OcsAdImportRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_import_user),
):
    return import_ocs_ad(db, payload, current_user["username"])


@router.get("/ocs-ad/runs/{run_id}", response_model=OcsAdImportResponse)
def get_import_run(
    run_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(get_import_user),
):
    run = db.get(OcsImportRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Запуск импорта не найден")
    return OcsAdImportResponse.model_validate_json(run.report_json)
