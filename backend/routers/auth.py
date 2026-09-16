import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt

from schemas import Token

router = APIRouter()

_SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
_ADMIN_LOGIN = os.getenv("ADMIN_LOGIN", "admin")
_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
_ALGORITHM = "HS256"
_EXPIRE_MINUTES = 60 * 8

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, _SECRET_KEY, algorithm=_ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, _SECRET_KEY, algorithms=[_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc
    return {"username": username}


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends()):
    login_ok = secrets.compare_digest(form.username, _ADMIN_LOGIN)
    password_ok = secrets.compare_digest(form.password, _ADMIN_PASSWORD)
    if not (login_ok and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect login or password",
        )
    return {"access_token": _create_token(form.username), "token_type": "bearer"}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    return current_user
