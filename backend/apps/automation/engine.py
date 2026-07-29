"""The automation runtime (PRD §24): match rules, evaluate conditions, run actions.

Kept deliberately small and defensive — a broken rule must never break the user
action that triggered it, so every rule runs inside its own try/except and is
logged either way.
"""
from __future__ import annotations

import logging

from django.db.models import F, Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# Fields a condition may test on the triggering task.
CONTEXT_FIELDS = ["status", "category", "priority", "task_type", "is_overdue", "has_open_blocker"]


def task_context(task) -> dict:
    return {
        "status": task.status,
        "category": task.category,
        "priority": task.priority,
        "task_type": task.task_type,
        "is_overdue": task.is_overdue,
        "has_open_blocker": task.blockers.filter(resolved_at__isnull=True).exists(),
    }


def _match(condition: dict, ctx: dict) -> bool:
    field = condition.get("field")
    op = condition.get("op", "eq")
    value = condition.get("value")
    actual = ctx.get(field)
    if op == "eq":
        return str(actual) == str(value)
    if op == "ne":
        return str(actual) != str(value)
    if op == "in":
        return str(actual) in [str(v) for v in (value or [])]
    if op == "is_true":
        return bool(actual) is True
    if op == "is_false":
        return bool(actual) is False
    return False


def conditions_met(conditions, ctx: dict) -> bool:
    return all(_match(c, ctx) for c in (conditions or []))


# --------------------------------------------------------------------------- #
# Actions
# --------------------------------------------------------------------------- #
def _message(action: dict, rule, default: str) -> str:
    return (action.get("message") or "").strip() or default


def _notify(recipients, action, rule, task, project, default_title):
    from apps.notifications.models import NotificationEvent
    from apps.notifications.services import notify_many
    notify_many(
        [r for r in recipients if r is not None],
        event=NotificationEvent.AUTOMATION,
        title=_message(action, rule, default_title),
        task=task, project=project,
    )


def _act_notify_owners(action, *, task, project, actor, rule):
    if task is None:
        return
    _notify(list(task.owners.all()), action, rule, task, project, f"Automation: {task.title}")


def _act_notify_primary(action, *, task, project, actor, rule):
    if task is None or task.primary_owner is None:
        return
    _notify([task.primary_owner], action, rule, task, project, f"Automation: {task.title}")


def _act_notify_manager(action, *, task, project, actor, rule):
    from apps.accounts.rbac import Capability
    from apps.projects.models import Membership
    if project is None:
        return
    managers = [
        m.user for m in Membership.objects.filter(project=project).select_related("user")
        if m.user and m.user.has_capability(Capability.MANAGE_PROJECT)
    ]
    if project.manager_id and project.manager not in managers:
        managers.append(project.manager)
    _notify(managers, action, rule, task, project, f"Automation: {project.code}")


def _act_set_priority(action, *, task, project, actor, rule):
    value = action.get("value")
    if task is None or not value or task.priority == value:
        return
    task.priority = value
    task._skip_automation = True
    task.save(update_fields=["priority"])


def _act_set_status(action, *, task, project, actor, rule):
    from apps.tasks.models import Activity
    value = action.get("value")
    if task is None or not value or task.status == value:
        return
    task.status = value
    task.last_activity_at = timezone.now()
    task._skip_automation = True
    task.save(update_fields=["status", "last_activity_at"])
    Activity.objects.create(task=task, actor=None, verb=Activity.Verb.STATUS_CHANGED,
                            detail={"to": value, "by": "automation", "rule": rule.name})


def _act_add_tag(action, *, task, project, actor, rule):
    value = action.get("value")
    if task is None or not value:
        return
    tags = list(task.tags or [])
    if value in tags:
        return
    tags.append(value)
    task.tags = tags
    task._skip_automation = True
    task.save(update_fields=["tags"])


def _act_add_comment(action, *, task, project, actor, rule):
    from apps.tasks.models import Comment
    text = (action.get("text") or action.get("message") or "").strip()
    if task is None or not text:
        return
    Comment.objects.create(task=task, author=None, body=text)


def _act_flag_project_at_risk(action, *, task, project, actor, rule):
    from apps.projects.models import ProjectHealth
    if project is None or project.health == ProjectHealth.AT_RISK:
        return
    project.health = ProjectHealth.AT_RISK
    project.save(update_fields=["health"])


ACTIONS = {
    "notify_owners": _act_notify_owners,
    "notify_primary_owner": _act_notify_primary,
    "notify_manager": _act_notify_manager,
    "set_priority": _act_set_priority,
    "set_status": _act_set_status,
    "add_tag": _act_add_tag,
    "add_comment": _act_add_comment,
    "flag_project_at_risk": _act_flag_project_at_risk,
}


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #
def _log(rule, trigger, task, project, actions_run, ok=True, message=""):
    from .models import AutomationLog
    AutomationLog.objects.create(
        rule=rule, rule_name=rule.name, trigger=trigger, task=task, project=project,
        actions_run=actions_run, ok=ok, message=message,
    )


def _execute(rule, *, task, project, actor) -> list[str]:
    ran: list[str] = []
    for action in (rule.actions or []):
        handler = ACTIONS.get(action.get("type"))
        if handler is None:
            continue
        handler(action, task=task, project=project, actor=actor, rule=rule)
        ran.append(action["type"])
    return ran


def run_event(trigger, *, task=None, project=None, actor=None) -> int:
    """Run every active rule listening for ``trigger`` whose conditions hold.

    Returns the number of rules that fired. Never raises — a failing rule is
    isolated and logged.
    """
    from .models import AutomationRule

    proj = project or (task.project if task is not None else None)
    rules = AutomationRule.objects.filter(is_active=True, trigger=trigger).filter(
        Q(project__isnull=True) | Q(project=proj)
    ).order_by("order", "id")

    ctx = task_context(task) if task is not None else {}
    fired = 0
    for rule in rules:
        try:
            if task is not None and not conditions_met(rule.conditions, ctx):
                continue
            ran = _execute(rule, task=task, project=proj, actor=actor)
            _log(rule, trigger, task, proj, ran, ok=True)
            AutomationRule.objects.filter(pk=rule.pk).update(
                run_count=F("run_count") + 1, last_run_at=timezone.now()
            )
            fired += 1
        except Exception as exc:  # noqa: BLE001 — isolate a broken rule
            logger.exception("Automation rule %s failed", rule.pk)
            _log(rule, trigger, task, proj, [], ok=False, message=str(exc)[:280])
    return fired
