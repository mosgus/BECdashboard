"""SMTP email delivery for alert events and nightly digest.

Configuration priority (first wins):
  1. In-memory override set via set_active_config() — populated from the
     email_config DB table at startup and updated whenever the UI saves settings.
  2. Environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
     EMAIL_FROM, ALERT_RECIPIENTS.

If no config is available, is_configured() returns False and all send functions
return False gracefully — the evaluation pipeline continues without crashing.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import settings

logger = logging.getLogger(__name__)

# ── Active config override ─────────────────────────────────────────────────────
# Populated from the DB at startup; updated immediately when the user saves
# settings via PUT /api/ops/email/config. Avoids threading a DB session through
# the alert evaluation pipeline.

_active_config: dict | None = None


def set_active_config(cfg: dict | None) -> None:
    """Set (or clear) the in-memory SMTP config. Thread-safe for reads."""
    global _active_config
    _active_config = cfg


def _get_config() -> dict:
    """Return the active SMTP config: DB override first, env vars fallback."""
    if _active_config:
        return _active_config
    return {
        "smtp_host":  settings.smtp_host,
        "smtp_port":  settings.smtp_port or 587,
        "smtp_user":  settings.smtp_user,
        "smtp_pass":  settings.smtp_pass,
        "email_from": settings.email_from or settings.smtp_user,
        "recipients": settings.alert_recipients,
    }


# ── Public helpers ─────────────────────────────────────────────────────────────

def is_configured() -> bool:
    """Return True only if all required SMTP fields are available."""
    cfg = _get_config()
    return bool(
        cfg.get("smtp_host")
        and cfg.get("smtp_user")
        and cfg.get("smtp_pass")
        and cfg.get("recipients")
    )


def _recipients() -> list[str]:
    cfg = _get_config()
    raw = cfg.get("recipients") or ""
    return [r.strip() for r in raw.split(",") if r.strip()]


def _send(subject: str, plain_body: str, html_body: str | None = None) -> bool:
    """Low-level SMTP send. Returns True on success, False on any error."""
    if not is_configured():
        logger.info("email: not configured — skipping send")
        return False

    recipients = _recipients()
    if not recipients:
        return False

    cfg = _get_config()
    from_addr = cfg.get("email_from") or cfg.get("smtp_user")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(plain_body, "plain"))
    if html_body:
        msg.attach(MIMEText(html_body, "html"))

    try:
        port = int(cfg.get("smtp_port") or 587)
        with smtplib.SMTP(cfg["smtp_host"], port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(cfg["smtp_user"], cfg["smtp_pass"])
            server.sendmail(from_addr, recipients, msg.as_string())
        logger.info("email: sent '%s' to %s", subject, recipients)
        return True
    except Exception as exc:
        logger.error("email: send failed — %s", exc)
        return False


def send_alert_email(events: list[dict]) -> bool:
    """Send a summary email for newly triggered alert events."""
    if not events:
        return False

    subject = f"[Blue Eagle] {len(events)} Alert{'s' if len(events) != 1 else ''} Triggered"

    lines = ["Blue Eagle Alert Notification\n"]
    for ev in events:
        ticker = ev.get("ticker", "?")
        rule = ev.get("rule_type", "?")
        scope = ev.get("scope", "?")
        lines.append(f"• {ticker} — {rule} ({scope})")
        for k, v in ev.items():
            if k not in ("ticker", "rule_type", "scope"):
                lines.append(f"    {k}: {v}")
        lines.append("")

    lines.append("─────────────────────────────")
    lines.append("Manage alerts at your Blue Eagle dashboard.")
    lines.append("This is an automated notification — do not reply.")

    plain = "\n".join(lines)
    return _send(subject, plain)


def send_digest_email(digest: dict) -> bool:
    """Send the overnight digest as an email."""
    subject = f"[Blue Eagle] Overnight Digest — {digest.get('as_of_date', 'N/A')}"
    plain = digest.get("digest_text", "Digest not available.")
    return _send(subject, plain)


def send_test_email() -> tuple[bool, str]:
    """Send a test email. Returns (success, reason)."""
    if not is_configured():
        cfg = _get_config()
        missing = []
        if not cfg.get("smtp_host"):
            missing.append("SMTP Host")
        if not cfg.get("smtp_user"):
            missing.append("SMTP Username")
        if not cfg.get("smtp_pass"):
            missing.append("SMTP Password")
        if not cfg.get("recipients"):
            missing.append("Alert Recipients")
        return False, f"Missing settings: {', '.join(missing)}"

    ok = _send(
        subject="[Blue Eagle] Test Email — SMTP configured correctly",
        plain_body=(
            "This is a test email from your Blue Eagle dashboard.\n\n"
            "If you received this, your SMTP configuration is working correctly.\n\n"
            "— Blue Eagle Capital System"
        ),
    )
    if ok:
        return True, "Test email sent successfully."
    return False, "SMTP send failed — check server logs for details."
