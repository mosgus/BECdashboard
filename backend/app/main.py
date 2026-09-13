import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import Settings

app = FastAPI(title="Blue Eagle API")
settings = Settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Returns {"status": "ok", "python": "<major.minor.patch>"}"""
    version = sys.version.split()[0]
    return {"status": "ok", "python": version}
