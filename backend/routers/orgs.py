from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Branch, Department
from routers.auth import get_current_user
from schemas import (
    BranchCreate, BranchUpdate, BranchRead,
    DepartmentCreate, DepartmentUpdate, DepartmentRead,
)

router = APIRouter()

_auth = Depends(get_current_user)


# ---------------------------------------------------------------------------
# Branch
# ---------------------------------------------------------------------------

@router.get("/branches", response_model=List[BranchRead])
def list_branches(
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    return db.query(Branch).order_by(Branch.name).all()


@router.post("/branches", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    branch = Branch(**payload.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


@router.put("/branches/{branch_id}", response_model=BranchRead)
def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(branch, field, value)
    db.commit()
    db.refresh(branch)
    return branch


@router.delete("/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    if db.query(Department).filter(Department.branch_id == branch_id).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя удалить филиал: сначала удалите или перепривяжите все его отделы.",
        )
    db.delete(branch)
    db.commit()


# ---------------------------------------------------------------------------
# Department
# ---------------------------------------------------------------------------

@router.get("/departments", response_model=List[DepartmentRead])
def list_departments(
    branch_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    q = db.query(Department)
    if branch_id is not None:
        q = q.filter(Department.branch_id == branch_id)
    return q.order_by(Department.name).all()


@router.post("/departments", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    if payload.branch_id is not None and not db.get(Branch, payload.branch_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    dept = Department(**payload.model_dump())
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.put("/departments/{dept_id}", response_model=DepartmentRead)
def update_department(
    dept_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    data = payload.model_dump(exclude_unset=True)
    if "branch_id" in data and data["branch_id"] is not None:
        if not db.get(Branch, data["branch_id"]):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    for field, value in data.items():
        setattr(dept, field, value)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete("/departments/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    dept_id: int,
    db: Session = Depends(get_db),
    _: dict = _auth,
):
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    db.delete(dept)
    db.commit()
