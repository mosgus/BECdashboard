"""SMTP email delivery for alert events and nightly digest.

Configuration via environment variables:
  SMTP_HOST      — required (e.g. smtp.gmail.com)
  SMTP_PORT      — default 587 (STARTTLS)
  SMTP_USER      — required (login username)
  SMTP_PASS      — required (login password / app password)
  EMAIL_FROM     — sender address (defaults to SMTP_USER)
  ALERT_RECIPIENTS — comma-separated recipient list

If any required variable is unset, is_configured() returns False and all
send functions return False gracefully — the evaluation pipeline continues
without crashing.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import settings

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """Return True only if all required SMTP env vars are present."""
    return bool(
        settings.smtp_host
        and settings.smtp_user
        and settings.smtp_pass
        and settings.alert_recipients
    )


def _recipients() -> list[str]:
    if not settings.alert_recipients:
        return []
    return [r.strip() for r in settings.alert_recipients.split(",") if r.strip()]


def _send(subject: str, plain_body: str, html_body: str | None = None) -> bool:
    """Low-level SMTP send. Returns True on success, False on any error."""
    if not is_configured():
        logger.info("email: not configured — skipping send")
        return False

    recipients = _recipients()
    if not recipients:
        return False

    from_addr = settings.email_from or settings.smtp_user

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(plain_body, "plain"))
    if html_body:
        msg.attach(MIMEText(html_body, "html"))

    try:
        port = int(settings.smtp_port or 587)
        with smtplib.SMTP(settings.smtp_host, port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_pass)
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
        # Include evidence values
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
        missing = []
        if not settings.smtp_host:
            missing.append("SMTP_HOST")
        if not settings.smtp_user:
            missing.append("SMTP_USER")
        if not settings.smtp_pass:
            missing.append("SMTP_PASS")
        if not settings.alert_recipients:
            missing.append("ALERT_RECIPIENTS")
        return False, f"Missing env vars: {', '.join(missing)}"

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
