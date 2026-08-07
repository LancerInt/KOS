"""Seed a demo project so the Timeline and Workload pages have data to show.

Idempotent: each run rebuilds the single ``DEMO-PMO`` project (dates are anchored
to *today*, so they always look current). Pass ``--remove`` to delete it. Owners
are picked from existing active users — no users are created.

    python manage.py seed_pmo_demo
    python manage.py seed_pmo_demo --remove
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.rbac import ProjectRole
from apps.dependencies.models import Dependency, DependencyType
from apps.projects.models import Membership, Milestone, Project, ProjectHealth, ProjectStatus
from apps.tasks.models import Task, TimeEntry

CODE = "DEMO-PMO"
User = get_user_model()


class Command(BaseCommand):
    help = "Create a demo project with dated tasks, milestones, dependencies and logged time."

    def add_arguments(self, parser):
        parser.add_argument("--remove", action="store_true",
                            help="Delete the demo project instead of creating it.")

    def handle(self, *args, **opts):
        if opts["remove"]:
            deleted, _ = Project.objects.filter(code=CODE).delete()
            self.stdout.write(self.style.SUCCESS(f"Removed the demo project ({deleted} rows)."))
            return

        users = list(User.objects.filter(is_active=True).order_by("id"))
        if not users:
            self.stdout.write(self.style.ERROR("No active users to assign work to — seed users first."))
            return

        Project.objects.filter(code=CODE).delete()  # fresh each run

        today = timezone.now().date()
        owner = users[0]
        project = Project.objects.create(
            name="Product Launch (demo)", code=CODE, owner=owner,
            manager=users[1 % len(users)],
            description="Seeded demo data for the Timeline and Workload views.",
            start_date=today - timedelta(days=20),
            target_date=today + timedelta(days=25),
            status=ProjectStatus.ACTIVE, health=ProjectHealth.ON_TRACK,
        )

        # Visibility is membership-based — without this only superusers would see
        # the demo. Make every active user a member so anyone can explore it.
        for u in users:
            role = (ProjectRole.OWNER if u == owner
                    else ProjectRole.MANAGER if u == project.manager
                    else ProjectRole.CONTRIBUTOR)
            Membership.objects.get_or_create(
                user=u, project=project, defaults={"project_role": role, "added_by": owner},
            )

        def mk(title, start_off, due_off, status, est_hours, owner_i):
            person = users[owner_i % len(users)]
            task = Task.objects.create(
                title=title, project=project,
                start_date=today + timedelta(days=start_off),
                due_date=today + timedelta(days=due_off),
                status=status, estimate_minutes=int(est_hours * 60),
                created_by=owner, primary_owner=person,
                completed_at=timezone.now() if status == "completed" else None,
            )
            task.owners.add(person)
            return task

        t_spec = mk("Design & spec", -18, -6, "completed", 8, 0)
        t_api = mk("Build the API", -6, 4, "in_progress", 20, 1)
        t_ui = mk("Frontend UI", -2, 8, "in_progress", 16, 2)
        t_docs = mk("Write docs", -3, 10, "in_progress", 6, 3)
        t_qa = mk("QA & testing", 8, 16, "ready", 12, 1)
        t_launch = mk("Launch", 16, 20, "backlog", 4, 0)

        Milestone.objects.create(project=project, title="Alpha ready", due_date=today + timedelta(days=4), order=1)
        Milestone.objects.create(project=project, title="Go live", due_date=today + timedelta(days=20), order=2)

        # QA waits on API + UI; Launch waits on QA.
        for pred in (t_api, t_ui):
            Dependency.objects.create(successor=t_qa, predecessor_task=pred,
                                      dependency_type=DependencyType.FINISH_TO_START)
        Dependency.objects.create(successor=t_launch, predecessor_task=t_qa,
                                  dependency_type=DependencyType.FINISH_TO_START)

        # Log time within the current week so the Workload page is populated.
        monday = today - timedelta(days=today.weekday())
        plan = [
            (t_api, users[1 % len(users)], [(monday, 180), (monday + timedelta(days=1), 150), (monday + timedelta(days=2), 210)]),
            (t_ui, users[2 % len(users)], [(monday, 120), (monday + timedelta(days=2), 180)]),
            (t_docs, users[3 % len(users)], [(monday + timedelta(days=1), 90), (monday + timedelta(days=3), 120)]),
            (t_spec, users[0], [(monday, 60)]),
        ]
        entries = 0
        for task, person, blocks in plan:
            for day, minutes in blocks:
                if day <= today:  # never log a future day
                    TimeEntry.objects.create(task=task, user=person, minutes=minutes, spent_on=day, note="demo work")
                    entries += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seeded '{project.name}' ({CODE}): 6 tasks, 2 milestones, 3 dependencies, {entries} time entries. "
            f"Owner={owner.username}."
        ))
