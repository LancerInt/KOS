"""Task permissions (PRD §7.7, §11).

Rows are scoped to visible projects in each viewset's ``get_queryset`` (so an
invisible task 404s). These classes gate the *actions*: who may create, edit or
delete, per capability and ownership (§11.2, §12.3 "only owners, reviewers or
roles holding the capability may transition a task").
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from apps.accounts.rbac import Capability
from apps.projects.models import Project
from apps.projects.scoping import visible_projects

EDIT_ACTIONS = {"update", "partial_update", "set_status", "manage_owners"}


def project_of(obj) -> Project | None:
    project = getattr(obj, "project", None)
    if project is None:
        task = getattr(obj, "task", None)
        project = getattr(task, "project", None)
    return project


def can_see(user, project: Project | None) -> bool:
    if project is None:
        return False
    return visible_projects(user, Project.objects.filter(pk=project.pk)).exists()


def is_task_owner(user, task) -> bool:
    return task.primary_owner_id == user.pk or task.owners.filter(pk=user.pk).exists()


class TaskPermission(BasePermission):
    """Action + object gate for the Task viewset."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if view.action == "create":
            return user.is_superuser or user.has_capability(Capability.CREATE_TASKS)
        return True

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not can_see(user, project_of(obj)):
            return False
        if view.action in ("retrieve", "mine"):
            return True
        if user.is_superuser:
            return True
        if view.action in EDIT_ACTIONS:
            if is_task_owner(user, obj) and user.has_capability(Capability.UPDATE_ASSIGNED):
                return True
            return user.has_capability(Capability.ASSIGN_TASKS) or user.has_capability(Capability.MANAGE_PROJECT)
        if view.action == "destroy":
            return user.has_capability(Capability.MANAGE_PROJECT)
        return True


class TaskChildPermission(BasePermission):
    """Gate for subtasks / checklist items — edit needs task edit rights."""

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        task = getattr(obj, "task", None)
        if not can_see(user, project_of(obj)):
            return False
        if view.action == "retrieve":
            return True
        if user.is_superuser:
            return True
        if task and is_task_owner(user, task) and user.has_capability(Capability.UPDATE_ASSIGNED):
            return True
        return user.has_capability(Capability.ASSIGN_TASKS) or user.has_capability(Capability.MANAGE_PROJECT)


class CommentPermission(BasePermission):
    """Any project member with the Comment capability may comment (§10.2)."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if view.action == "create":
            return user.is_superuser or user.has_capability(Capability.COMMENT)
        return True

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not can_see(user, project_of(obj)):
            return False
        if view.action in ("update", "partial_update", "destroy"):
            return user.is_superuser or obj.author_id == user.pk
        return True
