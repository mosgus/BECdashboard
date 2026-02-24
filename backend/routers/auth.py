"""POST /api/auth/login — class login returning a JWT."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth import create_token, get_current_actor, verify_password
from config import settings

router = APIRouter()


class LoginRequest(BaseModel):
    password: str
    display_name: str

    @field_validator("display_name")
    @classmethod
    def non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be empty")
        return v


class LoginResponse(BaseModel):
    token: str
    actor: str
    expires_in: int


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    if not verify_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid class password")
    token = create_token(req.display_name)
    return LoginResponse(
        token=token,
        actor=req.display_name,
        expires_in=settings.jwt_expiry_hours * 3600,
    )


@router.get("/me")
def me(actor: str = Depends(get_current_actor)) -> dict:
    """Return the actor identity for the current token."""
    return {"actor": actor}
