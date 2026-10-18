from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.ratelimit import auth_limit
from ..db import get_db
from ..schemas import GoogleIn, LoginIn, RefreshIn, RegisterIn, TokenOut
from ..services import auth as auth_svc

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(auth_limit)])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    out = auth_svc.register(db, body.email, body.password, body.display_name)
    db.commit()
    return out


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_limit)])
def login(body: LoginIn, db: Session = Depends(get_db)):
    out = auth_svc.login(db, body.email, body.password)
    db.commit()
    return out


@router.post("/google", response_model=TokenOut, dependencies=[Depends(auth_limit)])
def google(body: GoogleIn, db: Session = Depends(get_db)):
    out = auth_svc.google_sign_in(db, body.id_token)
    db.commit()
    return out


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(auth_limit)])
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    out = auth_svc.refresh(db, body.refresh_token)
    db.commit()
    return out


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    auth_svc.logout(db, body.refresh_token)
    db.commit()
