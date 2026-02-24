"""Blue Eagle Portfolio Dashboard — FastAPI backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import alerts, optimize, portfolio, technicals

app = FastAPI(title="Blue Eagle API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio.router, prefix="/api/portfolio")
app.include_router(optimize.router, prefix="/api")
app.include_router(technicals.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
