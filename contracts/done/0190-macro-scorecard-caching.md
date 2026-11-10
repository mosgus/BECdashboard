# Contract 0190 — Macro scorecard: ETag revalidation and an in-memory cache

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, a browser that already holds the Macro scorecard gets `304 Not Modified` with
an empty body instead of 328 KB again. Returning to the Macro tab within one page load makes no
request at all.

## Why

`GET /macro/scorecard` returns the whole snapshot on every visit. That's 1.14 MB of JSON, which
Render's edge Brotli-compresses to 328 KB on the wire. The data changes about once a week at most.
`MacroPage` also refetches every time it mounts, so switching tabs and coming back downloads the
data again.

See `REBUILD.md` → Decided → "The Macro tab (`/macro`) …", including the note on why there is no
`GZipMiddleware`.

The version tag is a hash of the content, not of where it's stored. That way it keeps working
unchanged when the snapshot moves into the database in a later contract.

## Files

Modify:
- `backend/app/routers/macro.py`: add an ETag and `Cache-Control`, answer `If-None-Match` with 304.
- `backend/tests/test_api_macro.py`: the fixture clears the renamed cache, and the new tests below
  are added.
- `frontend/src/pages/MacroPage.tsx`: load through the cached loader instead of calling
  `getMacroScorecard()` directly.

Create:
- `frontend/src/lib/macroStore.ts`: `cachedLoader`.
- `frontend/src/lib/macroStore.test.ts`: its tests.

**Touch nothing else.** In particular, do not edit `frontend/src/api/client.ts`. If the work appears
to require editing a file not on this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface

### `backend/app/routers/macro.py`

Replace `_snapshot_bytes` with `_snapshot`, which returns the bytes and their ETag together and is
cached the same way:

```python
import hashlib

from fastapi import APIRouter, Header, HTTPException, Response

@lru_cache(maxsize=1)
def _snapshot() -> tuple[bytes, str]:
    body = SNAPSHOT_PATH.read_bytes()
    return body, f'"{hashlib.sha256(body).hexdigest()[:32]}"'


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    """Weak comparison (RFC 9110 8.8.3.2). Render's edge may rewrite the tag to W/"..." when it
    compresses the response, so the browser can send it back in that form."""
    if if_none_match is None:
        return False
    if if_none_match.strip() == "*":
        return True
    return any(tag.strip().removeprefix("W/") == etag for tag in if_none_match.split(","))


@router.get("/scorecard")
def get_scorecard(if_none_match: str | None = Header(default=None)) -> Response:
    try:
        body, etag = _snapshot()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Macro scorecard snapshot not found")
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if _etag_matches(if_none_match, etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)
```

- Keep the existing comment about serving stored bytes verbatim; it moves onto `_snapshot`.
- `Cache-Control: no-cache` means "store it, but check with the server before reusing it". It does
  **not** mean "don't cache". Do not change it to `no-store` or to a `max-age`. A newly published
  snapshot must show up on the next visit.

### `frontend/src/lib/macroStore.ts`

```ts
/** Wraps a loader so it runs at most once per page load. Every caller shares the same promise, both
 * while it's in flight and after it resolves. A rejection clears the cache, so the next call
 * retries instead of returning the old failure. */
export function cachedLoader<T>(load: () => Promise<T>): () => Promise<T>
```

### `frontend/src/pages/MacroPage.tsx`

At module scope, below the imports:

```ts
// One fetch per page load. Coming back to the tab reuses it, and a reload asks the server, which
// answers 304 when the snapshot is unchanged.
const loadMacroScorecard = cachedLoader(getMacroScorecard)
```

In the mount effect, call `loadMacroScorecard()` where it currently calls `getMacroScorecard()`.
Change nothing else in the file.

## Out of scope

- Do not add `GZipMiddleware` or any other middleware. See the `REBUILD.md` note.
- Do not add a time-based expiry to `cachedLoader`. A snapshot published while the tab is open shows
  up after a reload, and that is accepted.
- Do not move the snapshot into the database. That is a later contract.
- Do not change the snapshot file, `build_macro_scorecard.py`, or any Macro component.

## Acceptance criteria

1. `cd backend && .venv/bin/python -m pytest tests/test_api_macro.py -q` passes. The file contains
   these tests, in addition to the two that exist now. The first test is updated only to clear the
   renamed cache.
   - **a.** A plain `GET /macro/scorecard` returns 200. Its `etag` header matches the regex
     `^"[0-9a-f]{32}"$`, and its `cache-control` header equals `no-cache`.
   - **b.** Read the `etag` from a first response. Sending it back as `If-None-Match` returns 304
     with `response.content == b""` and the same `etag` header.
   - **c.** Sending `W/` + that etag returns 304.
   - **d.** Sending `"0000", <that etag>` (comma-separated) returns 304.
   - **e.** Sending `"0000"` returns 200 with the full body: `response.json()["groups"]` is non-empty.
   - **f.** Point `SNAPSHOT_PATH` (monkeypatched) at a `tmp_path` file containing `{"groups":[1]}`
     and read the etag. Then write `{"groups":[2]}` to the same file, call
     `macro._snapshot.cache_clear()`, and read the etag again. The two etags differ.
   - The tests derive the etag from a response. **None of them hardcodes the real snapshot's etag**,
     because it changes whenever the snapshot does.
2. `cd backend && .venv/bin/python -m pytest -q` passes. This is the whole backend suite.
3. `cd frontend && npx vitest run src/lib/macroStore.test.ts` passes, and covers:
   - Two sequential calls invoke `load` once and resolve to the same value.
   - Two calls made before the first resolves invoke `load` once.
   - After `load` rejects, the call that saw the rejection rejects. The next call invokes `load`
     again and resolves to its new value. Use `vi.fn()` with `mockRejectedValueOnce(new Error('x'))`,
     then `mockResolvedValueOnce(42)`.
4. `cd frontend && npx vitest run && npx tsc -b && npx oxlint src` all pass, and oxlint reports no
   warning in a file this contract touched.
5. `grep -n "getMacroScorecard()" frontend/src/pages/MacroPage.tsx` prints nothing.
   `grep -n "cachedLoader(getMacroScorecard)" frontend/src/pages/MacroPage.tsx` prints exactly one
   line.
6. `grep -n "_snapshot_bytes" backend/app/routers/macro.py backend/tests/test_api_macro.py` prints
   nothing.
7. **Planner-run, after Gunnar deploys.** Fetch the live route with
   `curl -s -o /dev/null -D - -H "Accept-Encoding: br" https://blue-eagle-backend.onrender.com/macro/scorecard`
   and note its `etag`. Repeat with `-H 'If-None-Match: <that etag>'`. The second request returns
   `HTTP/2 304`. This is the one check that covers the edge proxy rewriting the tag, which no local
   test can.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
> (No ad-hoc scripts are needed for this contract; use the commands below.)

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && .venv/bin/python -m pytest tests/test_api_macro.py -v; cd ..
cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3; cd ..
cd frontend && npx vitest run src/lib/macroStore.test.ts; cd ..
cd frontend && npx vitest run 2>&1 | tail -4 && npx tsc -b && npx oxlint src; cd ..
grep -n "getMacroScorecard()" frontend/src/pages/MacroPage.tsx
grep -n "cachedLoader(getMacroScorecard)" frontend/src/pages/MacroPage.tsx
grep -n "_snapshot_bytes" backend/app/routers/macro.py backend/tests/test_api_macro.py
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Deploy, then nothing to run.** The planner runs criterion 7 against the live API. If you want to
  see it in a browser: open `/macro`, then reload. In DevTools → Network, `scorecard` shows `304`
  and a transfer size of a few hundred bytes.

## Open questions

None. If something here contradicts the code as it stands, report `BLOCKED`.
