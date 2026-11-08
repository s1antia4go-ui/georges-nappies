"""Outgoing email. Uses SMTP when configured; otherwise writes the email to the server log
(development only), so password reset works locally without an email provider."""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from .config import get_settings

log = logging.getLogger("mailer")


def _send_sync(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"] = s.smtp_from or s.smtp_user or "no-reply@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password or "")
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> None:
    s = get_settings()
    if not s.smtp_host:
        if s.environment == "production":
            log.error("SMTP is not configured; could not send '%s'", subject)
            return
        log.warning("SMTP not configured - development email to %s\nSubject: %s\n%s", to, subject, body)
        return
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
    except Exception:  # noqa: BLE001
        log.exception("Failed to send email '%s'", subject)
