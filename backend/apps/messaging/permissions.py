"""Who may open a direct message thread.

Messaging is open: any active member of the org can start a conversation with
any colleague, and once a thread exists both people are equal in it. (This used
to be a management-only action; it was opened up so anyone can reach anyone.)

Kept as a function rather than inlined so the one policy question — "may this
person open a new thread?" — has a single home, and so the group-chat code can
ask the same question when someone creates a group.
"""
from __future__ import annotations


def can_start_conversation(user) -> bool:
    """True if ``user`` may open a new thread with someone.

    Everyone who is signed in and active qualifies. The only bar is being a real,
    active account — a deactivated or anonymous user can't open threads.
    """
    return bool(
        user is not None
        and getattr(user, "is_authenticated", False)
        and getattr(user, "is_active", True)
    )
