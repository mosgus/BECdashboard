"""Blue Eagle API — v4.0.0 (actor-header identity + audit + persistence)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.base import Base, engine
from middleware.audit import AuditMiddleware
from routers import alert_rules, alerts, ops, optimize, portfolio, portfolios, technicals, ticker, universe, watchlists


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safety net: create tables if alembic hasn't run yet
    Base.metadata.create_all(bind=engine)

    # Seed in-memory email config from DB so the evaluator and all email
    # functions pick it up without needing a DB session at call time.
    try:
        from sqlalchemy.orm import Session as SyncSession
        from db.models import EmailConfig
        from core.notify.email import set_active_config
        with SyncSession(engine) as db:
            ec = db.query(EmailConfig).first()
            if ec and ec.smtp_host:
                set_active_config({
                    "smtp_host":  ec.smtp_host,
                    "smtp_port":  ec.smtp_port or 587,
                    "smtp_user":  ec.smtp_user,
                    "smtp_pass":  ec.smtp_pass,
                    "email_from": ec.email_from or ec.smtp_user,
                    "recipients": ec.recipients,
                })
    except Exception:
        pass  # table may not exist yet on first boot before migration

    yield


app = FastAPI(title="Blue Eagle API", version="4.0.0", lifespan=lifespan)

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
app.include_router(ops.router,          prefix="/api",           tags=["ops"])


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
    return {"status": "ok", "db": db_status, "version": "4.0.0"}
