"""Who may open a direct message thread.

Deliberately asymmetric: starting a conversation is a management action, but
once a thread exists both people are equal in it. That way staff can always
answer the person who wrote to them, and nobody can cold-DM a colleague.

The role names are held here rather than reused from workspace access so that
messaging policy and workspace visibility can move independently — they answer
different questions.
"""
from __future__ import annotations

# Matched by ``Role.name``. Both spellings of the management role are accepted:
# ``seed_org_roles`` renames "Management (MD / Director)" to "Management", and a
# deployment may sit on either side of that migration.
DM_INITIATOR_ROLES = frozenset({"Management", "Management (MD / Director)", "IT Team"})


def can_start_conversation(user) -> bool:
    """True if ``user`` may open a new thread with someone."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if user.is_superuser:
        return True
    try:
        if "administer" in user.effective_capabilities():
            return True
    except Exception:
        pass
    return user.roles.filter(name__in=DM_INITIATOR_ROLES).exists()
