"""CRUD endpoints for admin-managed portfolio presets (contract 0156)."""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.db import is_enabled, session
from app.models import Preset
from app.schemas import PresetIn, PresetOut, PresetsResponse

router = APIRouter(prefix="/presets", tags=["presets"])

_DATABASE_NOT_CONFIGURED = "Database not configured"


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes despite timezone=True; rows are written as UTC."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _preset_out(preset: Preset) -> dict:
    return {
        "id": preset.id,
        "name": preset.name,
        "description": preset.description,
        "csv": preset.csv,
        "created_at": _as_utc(preset.created_at),
        "updated_at": _as_utc(preset.updated_at),
    }


@router.get("", response_model=PresetsResponse)
def get_presets() -> dict:
    _require_database()
    with session() as db:
        presets = db.scalars(select(Preset).order_by(Preset.created_at.asc(), Preset.id.asc())).all()
        return {"presets": [_preset_out(preset) for preset in presets]}


@router.post("", response_model=PresetOut, status_code=201)
def create_preset(data: PresetIn) -> dict:
    _require_database()
    now = datetime.now(timezone.utc)
    preset = Preset(id=uuid4().hex, **data.model_dump(), created_at=now, updated_at=now)
    with session() as db:
        db.add(preset)
        db.flush()
        return _preset_out(preset)


@router.put("/{preset_id}", response_model=PresetOut)
def update_preset(preset_id: str, data: PresetIn) -> dict:
    _require_database()
    with session() as db:
        preset = db.get(Preset, preset_id)
        if preset is None:
            raise HTTPException(status_code=404, detail=f"Preset {preset_id} not found")
        preset.name = data.name
        preset.description = data.description
        preset.csv = data.csv
        preset.updated_at = datetime.now(timezone.utc)
        db.flush()
        return _preset_out(preset)


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: str) -> Response:
    _require_database()
    with session() as db:
        preset = db.get(Preset, preset_id)
        if preset is None:
            raise HTTPException(status_code=404, detail=f"Preset {preset_id} not found")
        db.delete(preset)
    return Response(status_code=204)
