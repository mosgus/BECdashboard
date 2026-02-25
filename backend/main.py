"""Blue Eagle API — v2.1.0 (actor-header identity + audit + persistence)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.base import Base, engine
from middleware.audit import AuditMiddleware
from routers import alert_rules, alerts, optimize, portfolio, portfolios, technicals, ticker, universe, watchlists


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safety net: create tables if alembic hasn't run yet (e.g. local dev without Docker)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Blue Eagle API", version="3.0.0", lifespan=lifespan)

# Middleware — added in reverse order (last added = outermost wrapper)
# AuditMiddleware must be inner so it sees final status codes from CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-Actor-Name", "X-Class-Key"],
    allow_credentials=True,
)
app.add_middleware(AuditMiddleware)

app.include_router(portfolio.router,    prefix="/api/portfolio", tags=["portfolio"])
app.include_router(optimize.router,     prefix="/api",           tags=["optimize"])
app.include_router(technicals.router,   prefix="/api",           tags=["technicals"])
app.include_router(alerts.router,       prefix="/api",           tags=["alerts"])
app.include_router(universe.router,     prefix="/api",           tags=["universe"])
app.include_router(watchlists.router,   prefix="/api",           tags=["watchlists"])
app.include_router(ticker.router,       prefix="/api",           tags=["ticker"])
app.include_router(portfolios.router,   prefix="/api",           tags=["portfolios"])
app.include_router(alert_rules.router,  prefix="/api",           tags=["alert_rules"])


@app.get("/health", tags=["ops"])
def health() -> dict:
    """Liveness + DB ping."""
    try:
        import sqlalchemy
        with engine.connect() as conn:
            conn.execute(sqlalchemy.text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"
    return {"status": "ok", "db": db_status, "version": "3.0.0"}
