# Report — Contract 0001, Backend scaffold

**Executed by:** haiku
**Status:** **accepted** (2026-09-13, after one round of required changes)

## Resolution

All three required changes verified by the planner, independently of the report:

| fix | verification |
|---|---|
| `backend/.env.example` created | file exists. **Contents not read** — `.claude/settings.json` denies `Read(.env.*)`, which this matches. Existence only. |
| `uvicorn[standard]==0.52.4` | `uvloop`, `httptools`, `watchfiles`, `websockets` all import from the venv ✅ |
| `.pytest_cache/` gitignored | `.gitignore:10` ✅ |
| regression check | `4 passed in 0.29s` ✅ |

Contract closed. The audit below is retained as the record of what the first pass missed.

> **Process note.** The executing session did not write this file; it pasted a summary into chat.
> The planner created this file to hold the audit. `agent_prompts/README.md` requires the coder to
> write `contracts/NNNN-slug.report.md` with verbatim command output — that is the entire reason
> the handoff goes through the filesystem rather than chat. A chat summary is the self-report the
> arrangement exists to avoid.

---

## Audit

**Verdict: the code is correct and I verified it independently. The contract is not complete —
one required file was never created, and one dependency deviates from the spec. Neither was
mentioned in a report that claimed all criteria met.**

### Re-run verification (planner, not pasted from the report)

| check | result |
|---|---|
| `python --version` via venv | `3.13.15` ✅ |
| `sys.prefix` | `…/backend/.venv` ✅ |
| `pytest -q` | `4 passed in 0.28s` ✅ |
| `/health` | `{"status":"ok","python":"3.13.15"}` ✅ |
| CORS, allowed origin | `access-control-allow-origin: http://localhost:5173` ✅ |
| CORS, **unlisted** origin (extra check) | no header echoed — correctly rejected ✅ |
| test deps in `requirements.txt` | none ✅ |
| `.python-version` | `3.13` ✅ |

### Findings

**1. `backend/.env.example` was never created. Required by the contract's Files list.**
Not mentioned in the report, which asserted all criteria met. It matters beyond tidiness: it is the
documented inventory of environment variables (`CORS_ORIGINS`) that has to be set in Render's
dashboard at deploy time. Deploying without it means rediscovering the variable names by reading
`config.py`.

**Contract defect, mine, recorded so it is not repeated:** `.env.example` appeared in *Files* but
had no corresponding acceptance criterion, so nothing checked it. Every required file needs a
criterion, or it is optional in practice. Contracts 0002 and 0003 have the same latent gap for
their `.env.example` / `.env.local` entries.

**2. `requirements.txt` pins `uvicorn==0.52.4`, but the contract specified `uvicorn[standard]`.**
The extras (`uvloop`, `httptools`, `watchfiles`, `websockets`) are silently absent. The app still
starts and serves — which is why nothing caught it — but this is a real deviation from an
explicitly enumerated dependency list, and the degradation is invisible rather than loud.

**3. `.pytest_cache/` is untracked and not gitignored.** Cosmetic; `__pycache__/` is covered but
`.pytest_cache/` is not.

### What is genuinely good, specifically

- `cache.py` normalizes on **both** read and write paths, not just one. A one-sided normalization
  passes the case-insensitive test as written (`store("aapl")` → `get_cached("AAPL")`) while
  failing the reverse. This implementation handles both.
- The tests call `clear()` at the *start* of each test rather than relying on test ordering or a
  fixture, so they pass in any order and in isolation.
- `assert_frame_equal` was used as specified, not `==` or `.equals()`, so a dtype or index change
  fails the test rather than passing silently.
- No `except: pass`, no broad `except Exception`, no stubs, no `TODO`, no `NotImplementedError`.
- Scope was not widened: nothing outside the contract's file list was touched, and no endpoint,
  symbols module, or persistence was invented. Both "do not resolve" open questions were left
  alone.

### Required before this contract is accepted

1. Create `backend/.env.example` documenting `CORS_ORIGINS` (name, purpose, example value, and the
   note that it is comma-separated with no spaces). No real values.
2. Change `requirements.txt` line 2 to `uvicorn[standard]==0.52.4` and reinstall to confirm it
   resolves.
3. Add `.pytest_cache/` to `.gitignore`.
4. Write the verification output into this file, under a `## Verification` section, verbatim.

Items 1–3 are mechanical and total about four lines. They do not warrant a new contract number —
reopen 0001 in the same session.
