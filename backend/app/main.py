import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import Settings
from app.routers import universe

app = FastAPI(title="Blue Eagle API")
settings = Settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(universe.router)

if os.getenv("DEBUG_PROBE") == "1":
    from app.routers import debug
    app.include_router(debug.router)


@app.get("/health")
def health() -> dict:
    """Returns {"status": "ok", "python": "<major.minor.patch>"}"""
    version = sys.version.split()[0]
    return {"status": "ok", "python": version}
