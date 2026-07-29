"""Scheduled retention purge (PRD §26.4). Run by Celery beat or the management
command. Deliberately NOT part of the daily notification scan — purge is
destructive and should run on its own, less frequent schedule."""
from __future__ import annotations

from celery import shared_task


@shared_task
def purge_expired_records() -> dict:
    from .retention import run_purge

    return run_purge()
