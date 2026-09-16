# --- Provenance -------------------------------------------------------------
# Copied verbatim from: main/LLM/news_summarizer.py (TCM.io, 2026-09-15)
# Changed: nothing below this header. The one import,
# `from .service import gem_client as _gem_client, gemini_model as _gemini_model`,
# is a relative import that won't resolve standalone — see llm_client_setup.py
# in this same directory for the (non-verbatim, extracted) replacement, or
# swap the two module-level calls near the bottom for whatever LLM client
# your other project already uses.
#
# The interesting part to preserve is the three-way prompt branch in
# summarize_news_articles(): no-previous-summary (cold start) vs.
# previous-summary-from-today (rewrite in place) vs.
# previous-summary-from-a-prior-day (open with a yesterday comparison, then
# cover today). See ../README.md, "The continuity prompt pattern".
# -----------------------------------------------------------------------------
"""LLM-powered news briefing — Gemini summarizes the current Currents feed."""

import sys
from datetime import datetime as _dt
from urllib.parse import urlparse

from .service import gem_client as _gem_client, gemini_model as _gemini_model


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def _is_same_day(timestamp: str) -> bool:
    try:
        return _dt.fromisoformat(timestamp).date() == _dt.utcnow().date()
    except Exception:
        return False


def summarize_news_articles(
    articles: list[dict],
    previous_summary: str | None = None,
    previous_timestamp: str | None = None,
) -> str:
    """Return an executive briefing summarizing today's headlines.

    If a previous_summary is provided the prompt branches:
    - Same day: extend and update the earlier briefing (grows through the day).
    - Prior day: open with what changed since yesterday, then cover today fully.
    """
    if not articles:
        return ""

    headlines = "\n".join(
        f"- {a['title']} ({_domain(a.get('url', ''))})"
        for a in articles[:20]
    )

    sentence_count = 12
    focus = (
        "Focus on macro themes, effects on interest rates/SOFR, credit conditions, and sectors relevant to commercial investment. "
        "Skip company-specific items unless they reflect a broader market trend. "
        "Plain sentences only — no bullet points, no headers, no markdown."
        )

    if previous_summary and previous_timestamp:
        if _is_same_day(previous_timestamp):
            prompt = (
                "You are a financial news analyst for a real estate private equity firm.\n"
                "Below is an earlier briefing from today, followed by the latest headlines.\n"
                "Rewrite the briefing to reflect what has shifted or newly emerged. "
                f"{sentence_count} sentences maximum total. Drop anything no longer relevant; add only what meaningfully changes the picture. "
                f"{focus}\n\n"
                f"Earlier briefing:\n{previous_summary}\n\n"
                f"Latest headlines:\n{headlines}\n\nUpdated briefing:"
            )
        else:
            prompt = (
                "You are a financial news analyst for a real estate private equity firm.\n"
                "Below is yesterday's market briefing, followed by today's headlines.\n"
                "Write today's briefing in exactly this structure: "
                "touch on how sentiment or key themes have shifted since yesterday/days prior, "
                "then cover most relevant developments. "
                f"{sentence_count} sentences maximum total. "
                f"{focus}\n\n"
                f"Yesterday's briefing:\n{previous_summary}\n\n"
                f"Today's headlines:\n{headlines}\n\nToday's briefing:"
            )
    else:
        prompt = (
            "You are a financial news analyst for a real estate private equity firm. "
            "Below are today's top headlines from major publications.\n"
            f"Write {sentence_count} sentences maximum total. "
            f"{focus}\n\n"
            f"Headlines:\n{headlines}\n\nBriefing:"
        )

    try:
        response = _gem_client.models.generate_content(
            model=_gemini_model,
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        print(f"[news_summarizer] Gemini briefing generation failed: {e}", file=sys.stderr)
        return ""
