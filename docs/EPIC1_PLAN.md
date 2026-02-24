# Epic 1 — Production Foundation: Implementation Plan

> Sprint 1 / Week 1
> Status: READY TO IMPLEMENT
> Author: Engineering lead review of proposed Epic 1 brief

---

## Divergences from Proposed Plan

| Item | Proposed | This Plan | Reason |
|------|----------|-----------|--------|
| SQLAlchemy mode | async (asyncpg) | **sync (psycopg2)** | Only 2 DB ops in Sprint 1: audit write + login check. Async adds Alembic env complexity for zero latency gain. Upgrade in Sprint 3 if needed. |
| Password storage | `CLASS_PASSWORD_HASH` bcrypt | **`CLASS_PASSWORD` plaintext + `secrets.compare_digest`** | bcrypt hash requires a keygen step that breaks "clone → up in 5 min". Timing-safe compare prevents the only realistic attack. Document the bcrypt upgrade path. |
| Token storage | memory + httpOnly cookie | **localStorage only** | httpOnly cookies from `backend:8000` don't auto-attach on `frontend:3000` without same-origin proxy or explicit `SameSite=None; Secure`. localStorage + 8h expiry is correct for this cross-origin dev setup. |
| `app_settings` table | optional | **dropped entirely** | YAGNI. Config belongs in env vars. |
| `job_runs` table | included | **deferred to Sprint 2** | APScheduler not added until Sprint 2. Don't pre-create tables for non-existent processes. |
| Branding tokens | separate `tokens.css` | **in `globals.css` `@theme` block** | Tailwind v4 already uses `@import "tailwindcss"` + `@theme` in globals.css. A second file is redundant; this is the correct v4 pattern. |
| Route protection | unspecified | **client-side `useAuth()` hook** | Next.js `middleware.ts` cannot read localStorage (server/edge context). Client-side hook is correct for this auth model. |

---

## Architecture After Epic 1

```
blue-eagle/
├── backend/
│   ├── alembic/
│   │   ├── alembic.ini          NEW
│   │   ├── env.py               NEW
│   │   └── versions/
│   │       └── 0001_baseline.py NEW
│   ├── db/
│   │   ├── __init__.py          NEW
│   │   ├── base.py              NEW  ← engine, Base, SessionLocal
│   │   ├── models.py            NEW  ← AuditLog, Universe
│   │   └── session.py           NEW  ← get_db dependency
│   ├── middleware/
│   │   ├── __init__.py          NEW
│   │   └── audit.py             NEW  ← AuditMiddleware
│   ├── routers/
│   │   └── auth.py              NEW  ← POST /api/auth/login
│   ├── auth.py                  NEW  ← JWT utils + get_current_actor dep
│   ├── config.py                NEW  ← pydantic-settings
│   ├── main.py                  MODIFIED
│   └── requirements.txt         MODIFIED
│
├── frontend/
│   ├── app/
│   │   ├── login/
│   │   │   └── page.tsx         NEW
│   │   ├── layout.tsx           MODIFIED  ← Providers + AuthGuard
│   │   ├── page.tsx             MODIFIED  ← useMutation
│   │   ├── optimize/page.tsx    MODIFIED  ← useMutation
│   │   ├── technicals/page.tsx  MODIFIED  ← useMutation
│   │   ├── alerts/page.tsx      MODIFIED  ← useMutation
│   │   └── globals.css          MODIFIED  ← design tokens in @theme
│   ├── components/
│   │   └── Providers.tsx        NEW  ← QueryClientProvider wrapper
│   ├── hooks/
│   │   └── useAuth.ts           NEW  ← token + redirect logic
│   └── lib/
│       ├── auth.ts              NEW  ← getToken, setToken, clearToken
│       ├── api.ts               MODIFIED  ← attach Authorization header
│       └── utils.ts             MODIFIED  ← apiPost reads token
│
├── docker-compose.yml           MODIFIED  ← add db service, build arg
├── frontend/Dockerfile          MODIFIED  ← ARG NEXT_PUBLIC_API_URL
├── backend/Dockerfile           MODIFIED  ← run migrations on boot
├── .env.example                 NEW
└── README.md                    MODIFIED
```

**New files: 15 | Modified files: 10 | Deleted: 0**

---

## Database Schema — Migration 0001

```sql
-- audit_log: written by AuditMiddleware for every POST/PUT/PATCH/DELETE
CREATE TABLE audit_log (
    id          SERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor       TEXT,           -- display_name from JWT; NULL if unauthenticated
    method      TEXT NOT NULL,  -- POST / PUT / PATCH / DELETE
    path        TEXT NOT NULL,  -- /api/optimize
    status_code INTEGER NOT NULL,
    latency_ms  INTEGER NOT NULL,
    body_hash   TEXT,           -- sha256[:16] of request body bytes
    request_id  TEXT            -- UUID4[:8] for log correlation
);
CREATE INDEX ix_audit_log_ts    ON audit_log (ts DESC);
CREATE INDEX ix_audit_log_actor ON audit_log (actor);

-- universe: ticker catalog (seeded here, CRUD in Sprint 2)
CREATE TABLE universe (
    ticker      TEXT PRIMARY KEY,
    added_by    TEXT NOT NULL DEFAULT 'seed',
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO universe (ticker) VALUES
    ('AAPL'),('MSFT'),('GOOGL'),('AMZN'),('NVDA'),
    ('META'),('TSLA'),('BRK-B'),('JPM'),('V'),
    ('SPY'),('QQQ'),('IWM'),('VT'),('GLD');
```

---

## New API Endpoints

### `POST /api/auth/login`

```json
// Request
{ "password": "class-secret", "display_name": "Alice Chen" }

// Response 200
{ "token": "<jwt>", "actor": "Alice Chen", "expires_in": 28800 }

// Response 401
{ "detail": "Invalid class password" }

// Response 422
{ "detail": "display_name must not be empty" }
```

JWT payload: `{ "sub": "Alice Chen", "iat": 1234567890, "exp": 1234596690 }`

### `GET /api/auth/me` (optional, useful for frontend session restore)

```json
// Response 200 (valid token in Authorization header)
{ "actor": "Alice Chen" }
```

### All existing endpoints — auth change

`POST /api/portfolio/metrics`, `POST /api/optimize`, `POST /api/technicals`, `POST /api/alerts/check`
→ Now require `Authorization: Bearer <token>` header
→ Return `401 Unauthorized` if missing or invalid
→ Return `401 Unauthorized` if token expired

---

## File-by-File Implementation

### backend/config.py

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    class_password: str
    jwt_secret: str
    jwt_expiry_hours: int = 8
    database_url: str
    cors_origins: str = "*"
    data_provider: str = "yfinance"

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
```

Validates on import — app won't start if `CLASS_PASSWORD`, `JWT_SECRET`, or `DATABASE_URL` are missing.

---

### backend/db/base.py

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,       # reconnect on stale connections
    pool_size=5,
    max_overflow=10,
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

class Base(DeclarativeBase):
    pass
```

---

### backend/db/models.py

```python
from datetime import datetime
from sqlalchemy import Integer, String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from db.base import Base

class AuditLog(Base):
    __tablename__ = "audit_log"

    id:          Mapped[int]            = mapped_column(Integer, primary_key=True)
    ts:          Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor:       Mapped[str | None]     = mapped_column(Text, index=True)
    method:      Mapped[str]            = mapped_column(String(10))
    path:        Mapped[str]            = mapped_column(Text)
    status_code: Mapped[int]            = mapped_column(Integer)
    latency_ms:  Mapped[int]            = mapped_column(Integer)
    body_hash:   Mapped[str | None]     = mapped_column(String(16))
    request_id:  Mapped[str | None]     = mapped_column(String(8))

class Universe(Base):
    __tablename__ = "universe"

    ticker:    Mapped[str]      = mapped_column(Text, primary_key=True)
    added_by:  Mapped[str]      = mapped_column(Text, default="seed")
    added_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

---

### backend/db/session.py

```python
from typing import Generator
from sqlalchemy.orm import Session
from db.base import SessionLocal

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

---

### backend/auth.py

```python
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Header
from jose import JWTError, jwt
from config import settings

ALGORITHM = "HS256"

def create_token(display_name: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=settings.jwt_expiry_hours)
    return jwt.encode(
        {"sub": display_name, "iat": now, "exp": exp},
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )

def decode_token(token: str) -> str:
    """Return display_name (sub) or raise JWTError."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    sub = payload.get("sub")
    if not sub:
        raise JWTError("Missing sub claim")
    return sub

def verify_password(plain: str) -> bool:
    return secrets.compare_digest(plain, settings.class_password)

async def get_current_actor(
    authorization: str | None = Header(default=None),
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return decode_token(authorization.removeprefix("Bearer "))
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

---

### backend/routers/auth.py

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from auth import create_token, decode_token, verify_password
from config import settings
from jose import JWTError

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
def me(authorization: str | None = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        actor = decode_token(authorization.removeprefix("Bearer "))
        return {"actor": actor}
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

---

### backend/middleware/audit.py

```python
import hashlib
import time
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from auth import decode_token
from db.base import SessionLocal
from db.models import AuditLog

AUDITED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()
        request_id = str(uuid.uuid4())[:8]

        # Cache body so it's still readable by the route handler
        body_bytes = await request.body()
        body_hash = hashlib.sha256(body_bytes).hexdigest()[:16] if body_bytes else None

        # Extract actor from JWT (best-effort; don't fail the request)
        actor: str | None = None
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            try:
                actor = decode_token(auth.removeprefix("Bearer "))
            except Exception:
                pass

        response = await call_next(request)

        latency_ms = int((time.perf_counter() - start) * 1000)

        if request.method in AUDITED_METHODS:
            try:
                db = SessionLocal()
                db.add(AuditLog(
                    ts=datetime.now(timezone.utc),
                    actor=actor,
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                    body_hash=body_hash,
                    request_id=request_id,
                ))
                db.commit()
            except Exception:
                pass  # Never let audit failure kill the request
            finally:
                db.close()

        return response
```

**Note**: We `try/except` the entire DB write and never surface errors to the caller. Audit failure is logged but never a 500.

---

### backend/main.py (full replacement)

```python
"""Blue Eagle API — v2.0.0 (auth + audit + persistence)."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db.base import Base, engine
from middleware.audit import AuditMiddleware
from routers import alerts, optimize, portfolio, technicals
from routers.auth import router as auth_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safety net: create tables if alembic hasn't run yet
    Base.metadata.create_all(bind=engine)
    yield

app = FastAPI(title="Blue Eagle API", version="2.0.0", lifespan=lifespan)

# Middleware order: audit runs before CORS (outermost = last added)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuditMiddleware)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(portfolio.router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(optimize.router, prefix="/api", tags=["optimize"])
app.include_router(technicals.router, prefix="/api", tags=["technicals"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])

@app.get("/health")
def health() -> dict:
    # Lightweight DB ping
    try:
        from db.base import engine
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"
    return {"status": "ok", "db": db_status, "version": "2.0.0"}
```

---

### backend/requirements.txt (additions)

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
yfinance>=0.2.37
pandas>=2.2.0
numpy>=1.26.0
scipy>=1.13.0
cachetools>=5.3.3
pydantic>=2.7.0
pydantic-settings>=2.0.0
python-multipart>=0.0.9
# Auth
python-jose[cryptography]>=3.3.0
# DB
sqlalchemy>=2.0.0
alembic>=1.13.0
psycopg2-binary>=2.9.9
```

---

### Protecting existing routers

Add `actor: str = Depends(get_current_actor)` to every POST endpoint in the 4 existing routers. Example diff for `routers/portfolio.py`:

```python
# Before
from fastapi import APIRouter, HTTPException

@router.post("/metrics")
def portfolio_metrics(req: PortfolioRequest) -> dict:

# After
from fastapi import APIRouter, Depends, HTTPException
from auth import get_current_actor

@router.post("/metrics")
def portfolio_metrics(req: PortfolioRequest, _actor: str = Depends(get_current_actor)) -> dict:
```

The `_actor` prefix signals it's required for auth but not used in the handler body (audit middleware captures it separately).

---

### Alembic setup

**`backend/alembic.ini`** — standard generated file, only change:
```ini
script_location = alembic
sqlalchemy.url = # left blank; set dynamically in env.py
```

**`backend/alembic/env.py`** (key section):
```python
from config import settings
from db.base import Base
from db import models  # noqa: F401 — import models to register metadata

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```

**`backend/Dockerfile`** — run migrations on boot:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
```

---

### frontend/lib/auth.ts

```typescript
const TOKEN_KEY = "be_token";
const ACTOR_KEY = "be_actor";

export const auth = {
  setSession(token: string, actor: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACTOR_KEY, actor);
  },
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  getActor(): string | null {
    return localStorage.getItem(ACTOR_KEY);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACTOR_KEY);
  },
  isLoggedIn(): boolean {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },
};
```

---

### frontend/hooks/useAuth.ts

```typescript
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/auth";

export function useAuth() {
  const router = useRouter();
  useEffect(() => {
    if (!auth.isLoggedIn()) {
      router.replace("/login");
    }
  }, [router]);
  return {
    actor: auth.getActor(),
    token: auth.getToken(),
    logout: () => { auth.clear(); router.replace("/login"); },
  };
}
```

---

### frontend/lib/utils.ts (updated apiPost)

```typescript
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const token = typeof window !== "undefined"
    ? localStorage.getItem("be_token")
    : null;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("be_token");
      localStorage.removeItem("be_actor");
      window.location.href = "/login";
    }
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
```

**Note**: On 401, clears session and redirects to `/login`. This handles token expiry transparently.

---

### frontend/lib/api.ts (add login call)

```typescript
// Add to existing exports:
export interface LoginRequest { password: string; display_name: string; }
export interface LoginResponse { token: string; actor: string; expires_in: number; }

export const login = (req: LoginRequest): Promise<LoginResponse> =>
  apiPost<LoginResponse>("/api/auth/login", req);
```

---

### frontend/app/login/page.tsx

```typescript
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { login } from "@/lib/api";
import { auth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const mutation = useMutation({
    mutationFn: () => login({ password, display_name: displayName }),
    onSuccess: (data) => {
      auth.setSession(data.token, data.actor);
      router.replace("/");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">🦅</div>
          <h1 className="mt-2 text-xl font-bold text-[var(--color-primary)]">Blue Eagle</h1>
          <p className="text-sm text-gray-500">Portfolio Dashboard</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice Chen"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && mutation.mutate()}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
          )}
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !displayName.trim() || !password}
            className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {mutation.isPending ? "Signing in…" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### frontend/components/Providers.tsx

```typescript
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
```

---

### frontend/app/layout.tsx (updated)

```typescript
import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Providers from "@/components/Providers";
import AuthNav from "@/components/AuthNav";  // actor display + logout button

export const metadata: Metadata = {
  title: "Blue Eagle Portfolio Dashboard",
  description: "Institutional-grade portfolio analytics, optimization, and alerts",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/optimize", label: "Optimization" },
  { href: "/technicals", label: "Technicals" },
  { href: "/alerts", label: "Alerts" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] antialiased">
        <Providers>
          <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
            <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
              <div className="flex h-14 items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🦅</span>
                  <span className="font-bold tracking-tight text-[var(--color-primary)]">Blue Eagle</span>
                  <span className="hidden text-xs text-gray-400 sm:inline">Portfolio Dashboard</span>
                </div>
                <nav className="flex items-center gap-1">
                  {NAV.map(({ href, label }) => (
                    <Link key={href} href={href}
                      className="rounded-[var(--radius-btn)] px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors">
                      {label}
                    </Link>
                  ))}
                  <AuthNav />
                </nav>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
```

---

### Design Tokens — frontend/app/globals.css

Extend the existing `@theme` block (Tailwind v4 syntax):

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;

  /* Blue Eagle brand tokens — edit these to reskin the entire app */
  --color-primary:  #1d4ed8;   /* nav, buttons, active state */
  --color-accent:   #f59e0b;   /* highlights, badges */
  --color-bg:       #f8fafc;   /* page background */
  --color-surface:  #ffffff;   /* cards, panels */
  --color-border:   #e2e8f0;   /* dividers */
  --color-text:     #0f172a;   /* body text */
  --color-muted:    #64748b;   /* labels, captions */
  --color-positive: #16a34a;   /* green — gains, success */
  --color-negative: #dc2626;   /* red — losses, error */

  --radius-card: 0.75rem;
  --radius-btn:  0.5rem;

  --font-heading: "Inter", system-ui, sans-serif;
  --font-body:    "Inter", system-ui, sans-serif;
}

@theme inline {
  --color-background:       var(--background);
  --color-foreground:       var(--foreground);
  --color-brand-primary:    var(--color-primary);
  --color-brand-accent:     var(--color-accent);
  --color-brand-surface:    var(--color-surface);
  --color-brand-border:     var(--color-border);
  --color-brand-positive:   var(--color-positive);
  --color-brand-negative:   var(--color-negative);
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}
```

**Branding swap process** (document in README):
1. Edit the 9 `--color-*` variables in `:root`
2. Update `--font-heading` / `--font-body` if changing typeface
3. Replace `🦅` emoji in layout with `<img src="/logo.svg" />`
4. Drop new `public/logo.svg` and `public/favicon.ico`

No other file changes needed.

---

### React Query migration for existing pages

All 4 pages follow the same pattern. Replace:

```typescript
// BEFORE
const [result, setResult] = useState<FooResponse | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const run = async () => {
  setLoading(true);
  setError(null);
  try {
    const r = await fetchFoo({ ...params });
    setResult(r);
  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : "Unknown error");
  } finally {
    setLoading(false);
  }
};
```

```typescript
// AFTER
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const { actor } = useAuth();  // also handles redirect if logged out

const mutation = useMutation({ mutationFn: fetchFoo });

// result  → mutation.data
// loading → mutation.isPending
// error   → mutation.error?.message
// run()   → mutation.mutate({ ...params })
```

The form inputs (controlled state) remain completely unchanged. Only the submit handler and result display change.

---

### docker-compose.yml (full replacement)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER:     blueeagle
      POSTGRES_PASSWORD: blueeagle
      POSTGRES_DB:       blueeagle
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U blueeagle"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env                    # CLASS_PASSWORD, JWT_SECRET, etc.
    environment:
      DATABASE_URL: postgresql://blueeagle:blueeagle@db:5432/blueeagle
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8000}
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy

volumes:
  pgdata:
```

**Key fix**: `frontend` now uses `build.args` to pass `NEXT_PUBLIC_API_URL` as a Docker build argument, so it's baked into the JS bundle at `npm run build` time — not set as a runtime env var (which is silently ignored by Next.js).

---

### frontend/Dockerfile (updated builder stage)

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Accept API URL as build arg — baked into the JS bundle
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

---

### .env.example

```bash
# ============================================================
# Blue Eagle — environment variables
# ============================================================
# 1. Copy this file: cp .env.example .env
# 2. Fill in CLASS_PASSWORD and JWT_SECRET
# 3. Run: docker compose up --build
# ============================================================

# Shared class login password (all students use the same one)
CLASS_PASSWORD=changeme

# JWT signing secret — generate with: openssl rand -hex 32
JWT_SECRET=replace-with-64-char-hex-string

# Token lifetime in hours (default: 8)
JWT_EXPIRY_HOURS=8

# ── Database ──────────────────────────────────────────────
# Set automatically by docker-compose. Override only if using
# an external Postgres instance.
# DATABASE_URL=postgresql://blueeagle:blueeagle@localhost:5432/blueeagle

# ── Frontend build ────────────────────────────────────────
# Baked into the JS bundle at docker compose up --build time.
# For local dev (not Docker), edit frontend/.env.local instead.
# In production: set to your public backend URL (Render/Fly.io).
NEXT_PUBLIC_API_URL=http://localhost:8000

# ── Optional ──────────────────────────────────────────────
# Restrict CORS in production (comma-separated origins)
CORS_ORIGINS=*
# Data provider: yfinance (default) | bloomberg (stub, not yet implemented)
DATA_PROVIDER=yfinance
```

---

## Dependency changes

### backend/requirements.txt — additions
```
pydantic-settings>=2.0.0
python-jose[cryptography]>=3.3.0
sqlalchemy>=2.0.0
alembic>=1.13.0
psycopg2-binary>=2.9.9
```

### frontend/package.json — removal
```bash
npm uninstall axios
```
`axios` is installed but never used (all fetches use native `fetch` in `utils.ts`). Remove to reduce bundle size and avoid drift.

---

## Acceptance Criteria — Verification Steps

```bash
# 1. Build and run from scratch
cp .env.example .env
# edit .env: set CLASS_PASSWORD=test123 and a JWT_SECRET
docker compose up --build
# Expected: 3 services healthy (db, backend, frontend)

# 2. Backend health check includes DB
curl http://localhost:8000/health
# Expected: {"status":"ok","db":"ok","version":"2.0.0"}

# 3. Auth — wrong password returns 401
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong","display_name":"Alice"}' | jq .
# Expected: {"detail":"Invalid class password"}

# 4. Auth — correct password returns JWT
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test123","display_name":"Alice Chen"}' | jq -r .token)
echo $TOKEN   # should be a 3-part JWT

# 5. Protected endpoint — no token returns 401
curl -s -X POST http://localhost:8000/api/optimize \
  -H "Content-Type: application/json" \
  -d '{"tickers":["AAPL","MSFT"],"start":"2023-01-01","end":"2024-01-01","mode":"max_sharpe"}' | jq .
# Expected: {"detail":"Not authenticated"}

# 6. Protected endpoint — valid token returns 200
curl -s -X POST http://localhost:8000/api/optimize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"tickers":["AAPL","MSFT"],"start":"2023-01-01","end":"2024-01-01","mode":"max_sharpe"}' | jq .opt_weights
# Expected: {"AAPL": 0.xxxx, "MSFT": 0.xxxx}

# 7. Audit log written
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test123","display_name":"Alice Chen"}' > /dev/null
# Then check DB:
docker exec $(docker compose ps -q db) psql -U blueeagle -c \
  "SELECT actor, method, path, status_code, latency_ms FROM audit_log ORDER BY ts DESC LIMIT 5;"
# Expected: rows with actor="Alice Chen", path="/api/auth/login"

# 8. Frontend route guard
# Open http://localhost:3000 in a private/incognito window
# Expected: redirected to /login

# 9. Frontend login flow
# On /login: enter display name + class password → should land on /
# Refresh the page → should stay on / (token persisted in localStorage)

# 10. Token expiry simulation
# Manually set an expired token in localStorage:
# localStorage.setItem("be_token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJUZXN0IiwiZXhwIjoxfQ.invalid")
# Reload page → should redirect to /login
```

---

## Epic 1 Exit Gate

All of the following must pass before Epic 2 begins:

- [ ] `docker compose up --build` succeeds cold on a clean machine
- [ ] `/health` returns `{"status":"ok","db":"ok"}`
- [ ] `POST /api/auth/login` with wrong password → `401`
- [ ] `POST /api/optimize` without token → `401`
- [ ] `POST /api/optimize` with valid token → `200` with results
- [ ] `audit_log` table has rows after any authenticated request
- [ ] Visiting `/` while logged out redirects to `/login`
- [ ] Login page works; session persists across page refresh
- [ ] Auto-redirect to `/login` on 401 response
- [ ] Design tokens in `globals.css`; nav uses token colors
- [ ] `axios` removed from `package.json`
- [ ] React Query `useMutation` used on all 4 existing pages
- [ ] `.env.example` present with all required vars documented
- [ ] `docker compose down -v && docker compose up --build` produces clean state (migrations re-run)
- [ ] README updated with first-run steps
