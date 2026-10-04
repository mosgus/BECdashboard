# Contract 0156 — Presets backend: table, seed migration, CRUD API

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Move portfolio presets out of `frontend/src/lib/presets.ts` and into the database. This is the
first of three contracts:
1. **This contract (backend):** a `presets` table, an Alembic migration `0009` that creates it
   and seeds the two current presets, and a CRUD API under `/presets`.
2. **0157 (frontend):** the New Portfolio dialog reads presets from the API, and the hard-coded
   list is removed.
3. **0158 (frontend):** an Admin → Presets section with create, edit and delete.

This contract changes **no frontend files**. Until 0157 ships, nothing calls the new endpoints, so
deploying this before the migration runs on production breaks nothing.

## Design decisions, already made

- **Each preset is stored as its canonical Blue Eagle CSV text.** That is the same string
  `presets.ts` holds today, and the string `serializePortfolioCsv` produces.
  - The frontend parser (`parsePortfolioCsv`) stays the single authority on CSV meaning: weight
    vs shares mode, CASH rows, rounding adjustments, and dropping tickers that aren't in the
    universe.
  - The backend validates shape and size only. It does **not** parse holdings.
- **IDs are strings.**
  - The two seeds keep their current ids, `test-concentrated` and `bec-2026-09-29`.
  - New presets get `uuid.uuid4().hex`.
- **Order** is `created_at` ascending, then `id` ascending.
- **The write endpoints are open**, like every other endpoint in this app. Gunnar has accepted
  that the Admin passkey is a UI gate only. Don't add authentication.

## Files

Create:
- `backend/migrations/versions/0009_presets.py`
- `backend/app/routers/presets.py`
- `backend/tests/test_api_presets.py`

Modify:
- `backend/app/models.py`: add the `Preset` model.
- `backend/app/schemas.py`: add the preset schemas.
- `backend/app/main.py`: add one import and one `app.include_router(presets.router)` line,
  following the existing pattern.

Touch nothing else.

## Model (`models.py`)

```python
class Preset(Base):
    """An admin-managed portfolio preset. `csv` is the canonical Blue Eagle portfolio CSV
    (header `ticker,weight_pct,shares` or `ticker,shares`); the frontend parses it."""

    __tablename__ = "presets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    csv: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

## Migration `0009_presets.py`

Follow the style of `0008_job_runs.py`:
- a docstring header naming this contract;
- `revision = "0009"` and `down_revision = "0008"`.

`upgrade()` does two things:
1. **Create the table.** Use `op.create_table("presets", …)` with the same columns, where `csv`
   is `sa.Text()` and both datetimes are `sa.DateTime(timezone=True)`, `nullable=False`.
2. **Seed two rows.** Use `op.bulk_insert` on a lightweight `sa.table("presets", sa.column(...)…)`.

Copy these two rows **exactly**. They are the current contents of `frontend/src/lib/presets.ts`,
and every character of each `csv` must match, including the trailing `\n`:

| id | name | description | csv | created_at = updated_at |
|---|---|---|---|---|
| `test-concentrated` | `Gunnar Preset` | `Gunnar's real and current allocations.` | `"ticker,weight_pct,shares\nMU,74.1847583834589,\nVOO,10.104829494715357,\nPBR,6.8215124159481295,\nORCL,4.426503750208732,\nSHNY,4.163845785064591,\nXIACF,0.2985501706042959,\nCASH,0,\n"` | `2026-09-01T00:00:00+00:00` |
| `bec-2026-09-29` | `BEC Portfolio` | `Blue Eagle Capital holdings as share counts, with $292,406.58 cash.` | `"ticker,shares\nXLK,184\nXLP,559\nXLV,410\nVEA,300\nMS,833\nSETM,870\nCEG,155\nGLD,113\nCASH,292406.58\n"` | `2026-09-29T00:00:00+00:00` |

Use `datetime(..., tzinfo=timezone.utc)` objects for the timestamps.

`downgrade()` drops the table.

**Don't run `alembic upgrade` against any real database.** `backend/.env` points at production,
and Gunnar applies the migration himself.

## Schemas (`schemas.py`)

```python
class PresetIn(BaseModel):
    name: str
    description: str = ""
    csv: str

class PresetOut(BaseModel):
    id: str
    name: str
    description: str
    csv: str
    created_at: datetime
    updated_at: datetime

class PresetsResponse(BaseModel):
    presets: list[PresetOut]
```

Validate `PresetIn` with `field_validator`s. Each one strips the value, stores the stripped
result, and raises `ValueError` (which FastAPI returns as 422) when:
- `name` is empty, or longer than 80 characters;
- `description` is longer than 200 characters;
- `csv` is empty, longer than 20,000 characters, or its first line doesn't start with `ticker,`.
  Compare in lowercase with all whitespace removed. `" Ticker , shares\n…"` passes.

For `csv`, strip only leading whitespace, then make sure it ends with exactly one `\n`. This
matches the format `serializePortfolioCsv` produces.

## Router (`routers/presets.py`)

Use `prefix="/presets"` and `tags=["presets"]`. Every route first calls a
`_require_database()` that returns 503 `"Database not configured"` when `not is_enabled()`, the
same as `routers/ops.py`.

| Route | Behaviour |
|---|---|
| `GET /presets` | `{"presets": [...]}` in the order above. |
| `POST /presets` | Status 201. Creates the preset with `id = uuid4().hex` and `created_at = updated_at = now (UTC)`. Returns `PresetOut`. |
| `PUT /presets/{preset_id}` | Replaces name, description and csv, and sets `updated_at = now`. `created_at` is unchanged. Returns `PresetOut`. Unknown id: 404 `f"Preset {preset_id} not found"`. |
| `DELETE /presets/{preset_id}` | Status 204 with no body (`Response(status_code=204)`). Unknown id: 404, same message. |

When SQLite returns naive datetimes, relabel them as UTC on the way out, using the same
`_as_utc` idea as `news.py`. Write a small local helper; don't import a private function from
another module.

## Tests (`tests/test_api_presets.py`)

Use the `db_mode` and `client` fixture pattern from `test_api_ops.py`: a temporary SQLite DB,
`Base.metadata.create_all`, and `TestClient(app)`. Write at least these tests:

1. `GET /presets` on an empty table returns `{"presets": []}`.
2. **POST then GET.**
   - The POST returns 201 with a 32-character hex `id`, the stripped `name`, and a `csv` ending
     in `"\n"`.
   - A following GET lists exactly that preset.
3. **Order.** Two presets inserted directly with explicit `created_at` values come back oldest
   first.
4. **PUT.**
   - It changes `name`, `description` and `csv`.
   - `created_at` is unchanged.
   - `updated_at` is greater than or equal to the original.
5. PUT to an unknown id returns 404, with the id in `detail`.
6. **DELETE.** It returns 204, and the preset is gone from GET.
7. DELETE of an unknown id returns 404.
8. **Validation 422s:**
   - a blank or whitespace-only name;
   - an 81-character name;
   - `csv="symbol,weight\nAAPL,100\n"`;
   - a csv of 20,001 characters that starts with `ticker,shares\n`.
9. **Header tolerance.** `csv=" Ticker , shares\nAAPL,1\nCASH,0"` is accepted, and the stored
   value ends with exactly one `"\n"`.
10. With `DATABASE_URL` unset, `GET /presets` returns 503.

## Acceptance criteria

Run these in bash from the repo root.

1. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes. The baseline is
   **757**; after this contract it is 757 plus the number of new tests. Paste the tail of the
   output.
2. **Offline SQL render.** This never connects to a database:
   - Run `(cd backend && DATABASE_URL="postgresql://offline@localhost/offline" .venv/bin/alembic upgrade 0008:0009 --sql > /tmp/0009.sql)`.
   - `grep -c "CREATE TABLE presets" /tmp/0009.sql` prints 1.
   - `grep -c "bec-2026-09-29" /tmp/0009.sql` and `grep -c "test-concentrated" /tmp/0009.sql`
     each print at least 1.
   - Paste the INSERT lines.
3. `grep -n "include_router(presets.router)" backend/app/main.py` prints 1 line.
4. No frontend file changed. Confirm by listing every file you touched.

`BLOCKED` is a valid answer. Report every deviation.

## Human verification — Gunnar

1. **Find out how production gets migrations.** Production is at revision `0008`. Check whether
   Render's build or start command runs `alembic upgrade head`; REBUILD.md says this is
   unverified.
   - If it doesn't, apply 0009 yourself from `backend/`: `PATH="$PWD/.venv/bin:$PATH" alembic upgrade head`.
     Your `.env` points at production.
   - **Do this before deploying 0157.**
2. **Confirm the migration landed.** `/ops/status` should show `revision: "0009"`.
3. **Confirm the seed.** `curl <backend>/presets` should list the two presets.

## Open questions

None.
