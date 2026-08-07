"""Shared base models for every KOS app (PRD §34 — shared engine).

`TimeStampedModel` gives every record created/updated stamps. Concrete audit of
*who* changed *what* (old value / new value / reason) lands in Module 13 via a
dedicated audit app; these mixins are the foundation it builds on.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    """Abstract base: automatic created/updated timestamps."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ("-created_at",)


class SavedView(TimeStampedModel):
    """A user's saved filter/sort/layout preset for a screen.

    ``config`` is an opaque JSON object owned by the frontend surface that
    created it — the API stores and returns it verbatim and never interprets its
    shape beyond "is an object". ``surface`` scopes a preset to one screen (e.g.
    ``"dashboard"``) so a single table can serve several screens later. Presets
    are strictly per user; the queryset is always filtered to ``request.user``.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_views"
    )
    surface = models.CharField(max_length=40, default="dashboard", db_index=True)
    name = models.CharField(max_length=80)
    config = models.JSONField(default=dict)

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "surface", "name"],
                name="uniq_savedview_owner_surface_name",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.owner_id}:{self.surface}:{self.name}"
