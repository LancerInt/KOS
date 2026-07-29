"""Shared base models for every KOS app (PRD §34 — shared engine).

`TimeStampedModel` gives every record created/updated stamps. Concrete audit of
*who* changed *what* (old value / new value / reason) lands in Module 13 via a
dedicated audit app; these mixins are the foundation it builds on.
"""
from __future__ import annotations

from django.db import models


class TimeStampedModel(models.Model):
    """Abstract base: automatic created/updated timestamps."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ("-created_at",)
