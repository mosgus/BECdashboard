# --- Provenance -------------------------------------------------------------
# Copied verbatim from: main/db/llm_output.py (TCM.io, 2026-09-15)
# Changed: nothing below this header.
#
# This is MongoDB-specific and is the one piece you're expected to port to
# PostgreSQL rather than reuse — it's included in full so the porting is
# faithful rather than guessed. See ../README.md "Storage: what you actually
# need to port" for a minimal Postgres schema and the three operations you
# need (get_latest, add, prune_expired), and for why the two TTLs
# (_SUMMARY_TTL_HOURS in news_section.py vs. _NEWS_SUMMARY_TTL_HOURS below)
# are deliberately not the same thing.
#
# Two imports are not reproduced anywhere in this bundle and have no
# equivalent file here — described in the README instead of stubbed out:
#   - `from .client import get_mongo_client, _DB_NAME, _LLM_OUTPUT_COL, _ASSETS_COL`
#     (a cached Mongo client + collection-name constants — your Postgres
#     connection setup replaces this)
#   - `from .changelog import log_change`
#     (an audit-log writer for this app's `changelog` collection — optional
#     to reproduce; only matters if you want the same audit trail)
#
# Only the news_summary path (get_latest_llm_output, add_llm_output, and the
# two _prune_expired_news_summaries / _backfill_news_expirations helpers) is
# relevant to the news section. get_am_reports() / delete_am_report() at the
# bottom are for an unrelated feature (AM Report narratives) that happens to
# share this same collection in the original app — included only because they
# were part of the source file; skip them.
# -----------------------------------------------------------------------------
"""
llm_output — reusable LLM-generated outputs across all pages.

Outputs are stored and reused; on regeneration the previous output is passed
back to the LLM as audit context. Auto-incrementing integer `output_id`.
"""

import streamlit as st
from datetime import datetime as _dt, timedelta as _td, timezone as _tz
from pymongo import ASCENDING

from .client import get_mongo_client, _DB_NAME, _LLM_OUTPUT_COL, _ASSETS_COL
from .changelog import log_change


_NEWS_SUMMARY_TTL_HOURS = 24
_NEWS_EXPIRY_FIELD = "news_expires_at"


def _news_expiry_from_timestamp(value) -> _dt:
    """Return the UTC expiry datetime for a stored news-summary timestamp.

    ``timestamp`` deliberately remains an ISO string because existing renderers
    use it as display data. MongoDB TTL indexes require a BSON datetime, hence
    the separate expiry field.
    """
    try:
        created = _dt.fromisoformat(str(value).replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=_tz.utc)
        return created.astimezone(_tz.utc) + _td(hours=_NEWS_SUMMARY_TTL_HOURS)
    except (TypeError, ValueError):
        # A malformed legacy timestamp cannot safely be retained forever.
        # Expire it on Atlas's next TTL sweep rather than guessing its age.
        return _dt.now(_tz.utc)


def _backfill_news_expirations(col) -> None:
    """Add retention timestamps to legacy news summaries once, with one audit row.

    The application uses this field after a successful replacement summary is
    saved. It deliberately does not run a server-side TTL index: that cannot
    preserve the final stale summary for the next briefing's context.
    """
    updated = 0
    for doc in col.find(
        {"output_type": "news_summary", _NEWS_EXPIRY_FIELD: {"$exists": False}},
        {"_id": 1, "timestamp": 1},
    ):
        result = col.update_one(
            {"_id": doc["_id"], _NEWS_EXPIRY_FIELD: {"$exists": False}},
            {"$set": {_NEWS_EXPIRY_FIELD: _news_expiry_from_timestamp(doc.get("timestamp"))}},
        )
        updated += result.modified_count
    if updated:
        log_change(
            "updated",
            0,
            f"{updated} existing news summaries",
            field_changed="24-hour news retention prepared",
            collection=_LLM_OUTPUT_COL,
        )


def _prune_expired_news_summaries(col, keep_output_id: int) -> None:
    """Delete expired older news summaries after saving a replacement.

    ``keep_output_id`` is the just-saved summary. Excluding it means a stale
    final summary always survives an idle period and can be supplied as context
    when Home is next opened and generates its replacement.
    """
    result = col.delete_many({
        "output_type": "news_summary",
        _NEWS_EXPIRY_FIELD: {"$lte": _dt.now(_tz.utc)},
        "output_id": {"$ne": keep_output_id},
    })
    if result.deleted_count:
        log_change(
            "deleted",
            keep_output_id,
            f"{result.deleted_count} expired news summaries",
            field_changed="expired news summaries",
            new_value=result.deleted_count,
            collection=_LLM_OUTPUT_COL,
        )


_INIT_DONE = False


def init_llm_output_collection() -> None:
    """Ensure llm_output indexes and migrate news-summary retention metadata.
    Runs once per process; a failure leaves the flag unset so it retries next render.

    _backfill_news_expirations' own docstring says it runs "once" -- gating this
    function is what makes that true; previously it re-scanned the collection
    every render.
    """
    global _INIT_DONE
    if _INIT_DONE:
        return
    try:
        db  = get_mongo_client()[_DB_NAME]
        if _LLM_OUTPUT_COL not in db.list_collection_names():
            db.create_collection(_LLM_OUTPUT_COL)
        col = db[_LLM_OUTPUT_COL]
        col.create_index([("output_id",  ASCENDING)], unique=True, background=True)
        col.create_index([("asset_id",   ASCENDING)], background=True)
        col.create_index([("timestamp",  ASCENDING)], background=True)
        col.create_index([("output_type", ASCENDING), ("timestamp", ASCENDING)], background=True)
        # Remove the short-lived TTL index introduced before the continuity
        # requirement was known. Atlas TTL cannot keep the newest stale row.
        if "news_summary_24h_ttl" in col.index_information():
            col.drop_index("news_summary_24h_ttl")
        _backfill_news_expirations(col)
        _INIT_DONE = True
    except Exception as e:
        st.error(f"Failed to initialise llm_output collection: {e}")


def get_latest_llm_output(
    output_type: str,
    asset_id: int | None = None,
) -> dict | None:
    """Return the most recent LLM output for a given type and optional asset, or None."""
    try:
        col  = get_mongo_client()[_DB_NAME][_LLM_OUTPUT_COL]
        filt = {"output_type": output_type}
        if asset_id is not None:
            filt["asset_id"] = asset_id
        return col.find_one(filt, {"_id": 0}, sort=[("timestamp", -1)])
    except Exception as e:
        st.error(f"Failed to fetch LLM output: {e}")
        return None


def add_llm_output(
    output_type: str,
    content: str,
    asset_id: int | None = None,
    deal_id: int | None = None,
    page: str | None = None,
    metadata: dict | None = None,
) -> bool:
    """Insert a new LLM-generated output into the llm_output collection."""
    if not content or not output_type:
        return False
    try:
        db   = get_mongo_client()[_DB_NAME]
        col  = db[_LLM_OUTPUT_COL]
        last = col.find_one(sort=[("output_id", -1)])
        output_id = (last["output_id"] + 1) if last else 1
        output = {
            "output_id":   output_id,
            "output_type": output_type,
            "content":     content,
            "timestamp":   _dt.utcnow().isoformat(),
            "asset_id":    asset_id,
            "deal_id":     deal_id,
            "page":        page,
            "metadata":    metadata,
        }
        if output_type == "news_summary":
            output[_NEWS_EXPIRY_FIELD] = _dt.now(_tz.utc) + _td(hours=_NEWS_SUMMARY_TTL_HOURS)
        col.insert_one(output)
        if asset_id is not None:
            asset_doc = db[_ASSETS_COL].find_one({"id": asset_id}, {"asset_name": 1})
            subject   = asset_doc.get("asset_name", f"asset {asset_id}") if asset_doc else f"asset {asset_id}"
        else:
            subject = f"{output_type} (page: {page or 'unknown'})"
        log_change("added", output_id, subject,
                   field_changed=output_type, collection=_LLM_OUTPUT_COL)
        if output_type == "news_summary":
            _prune_expired_news_summaries(col, output_id)
        return True
    except Exception as e:
        st.error(f"Failed to save LLM output: {e}")
        return False


def get_am_reports(asset_id: int) -> list[dict]:
    """All saved AM Report narratives for one asset, newest first. [] on empty or failure.

    Mirrors get_latest_llm_output's shape (same collection, same {"_id": 0}
    projection, same error-swallowing-into-a-safe-default convention) but
    returns every row rather than just the latest — the Generated Reports
    browser needs the full list, not only the most recent generation.
    """
    try:
        col = get_mongo_client()[_DB_NAME][_LLM_OUTPUT_COL]
        return list(col.find(
            {"output_type": "am_report", "asset_id": asset_id},
            {"_id": 0},
        ).sort("timestamp", -1))
    except Exception as e:
        st.error(f"Failed to fetch AM reports: {e}")
        return []


def delete_am_report(output_id: int) -> bool:
    """Delete ONE am_report row by output_id. True only on a confirmed single-row delete.

    Scoped by NAME (this function only ever deletes am_report rows) AND by
    FILTER ({"output_id": ..., "output_type": "am_report"} — both keys,
    deliberately). llm_output is shared with news_summary and asset_notes; a
    generic delete_llm_output(output_id) would be a footgun — one wrong id
    and a news briefing or an asset's notes summary is gone instead. This
    function is structurally incapable of touching a non-am_report row: even
    a wrong output_id can only ever match nothing, never someone else's row.

    Reads the row FIRST so the changelog entry can name it, then deletes with
    delete_one (never delete_many) and asserts deleted_count == 1 before
    reporting success — hard rule 3's lesson from the 2026-08-07 incident,
    where a delete_many on a non-unique field destroyed five unrelated
    changelog records alongside the two intended ones.
    """
    try:
        db   = get_mongo_client()[_DB_NAME]
        col  = db[_LLM_OUTPUT_COL]
        filt = {"output_id": output_id, "output_type": "am_report"}

        row = col.find_one(filt, {"_id": 0})
        if not row:
            return False

        result = col.delete_one(filt)
        if result.deleted_count != 1:
            return False

        asset_id = row.get("asset_id")
        period   = (row.get("metadata") or {}).get("period_typed", "")
        if asset_id is not None:
            asset_doc = db[_ASSETS_COL].find_one({"id": asset_id}, {"asset_name": 1})
            subject   = asset_doc.get("asset_name", f"asset {asset_id}") if asset_doc else f"asset {asset_id}"
        else:
            subject = f"asset {asset_id}"
        # NOTE (flagged, not silently worked around): log_change's
        # collection==_LLM_OUTPUT_COL branch (changelog.py) never checks
        # `action` — it always renders "🦾 New '<field_changed>' summary
        # saved for <name>", which was fine when this collection only ever
        # logged inserts. Passed action="deleted" here, the STORED `action`
        # field is correct, but the rendered `summary` text will misleadingly
        # read "New ... summary saved" for what is actually a deletion. That
        # branch's own file (main/db/changelog.py) isn't in this contract's
        # file list, so it isn't touched here — flagging it for the Lead
        # rather than expanding scope to fix it myself.
        log_change("deleted", output_id, subject,
                   field_changed=f"am_report ({period})" if period else "am_report",
                   collection=_LLM_OUTPUT_COL)
        return True
    except Exception as e:
        st.error(f"Failed to delete AM report: {e}")
        return False
