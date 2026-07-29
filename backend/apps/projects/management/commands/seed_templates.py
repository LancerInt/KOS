"""Seed the 6 launch project templates (PRD §10.6).

Idempotent. Run:  python manage.py seed_templates
Milestone ``offset_days`` are measured from the project start date; the
create-from-template flow turns them into real due dates (AC-6).
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.projects.models import Confidentiality, ProjectTemplate, ProjectType

TEMPLATES = [
    {
        "key": "regulatory-registration",
        "name": "Regulatory registration",
        "description": "CIBRC / EPA-style registration with submission, query and grant milestones.",
        "project_type": ProjectType.HYBRID,
        "structure": {
            "epics": [
                {"title": "Dossier preparation", "milestones": [
                    {"title": "Data compilation complete", "offset_days": 21},
                    {"title": "Dossier drafted", "offset_days": 45},
                ]},
                {"title": "Submission", "milestones": [
                    {"title": "Application submitted", "offset_days": 60},
                ]},
                {"title": "Review & query", "milestones": [
                    {"title": "Query response filed", "offset_days": 90},
                    {"title": "Registration granted", "offset_days": 150},
                ]},
            ],
        },
    },
    {
        "key": "product-launch",
        "name": "Product launch",
        "description": "End-to-end product launch from planning to post-launch review.",
        "project_type": ProjectType.HYBRID,
        "structure": {
            "epics": [
                {"title": "Planning", "milestones": [{"title": "Launch plan approved", "offset_days": 14}]},
                {"title": "Development", "milestones": [{"title": "Product ready", "offset_days": 60}]},
                {"title": "Go-to-market", "milestones": [{"title": "Marketing assets ready", "offset_days": 75}]},
                {"title": "Launch", "milestones": [
                    {"title": "Launch day", "offset_days": 90},
                    {"title": "Post-launch review", "offset_days": 105},
                ]},
            ],
        },
    },
    {
        "key": "marketing-campaign",
        "name": "Marketing campaign",
        "description": "Concept-to-report marketing campaign.",
        "project_type": ProjectType.HYBRID,
        "structure": {
            "epics": [
                {"title": "Concept", "milestones": [{"title": "Brief approved", "offset_days": 7}]},
                {"title": "Production", "milestones": [{"title": "Assets ready", "offset_days": 21}]},
                {"title": "Execution", "milestones": [{"title": "Campaign live", "offset_days": 30}]},
                {"title": "Wrap-up", "milestones": [{"title": "Results report", "offset_days": 45}]},
            ],
        },
    },
    {
        "key": "contract-manufacturing",
        "name": "Customer / contract-manufacturing project",
        "description": "Customer or contract-manufacturing engagement from spec to delivery.",
        "project_type": ProjectType.HYBRID,
        "structure": {
            "epics": [
                {"title": "Requirements", "milestones": [{"title": "Spec agreed", "offset_days": 14}]},
                {"title": "Sampling", "milestones": [{"title": "Sample approved", "offset_days": 35}]},
                {"title": "Production", "milestones": [{"title": "Batch produced", "offset_days": 70}]},
                {"title": "Delivery", "milestones": [{"title": "Shipped", "offset_days": 85}]},
            ],
        },
    },
    {
        "key": "software-development",
        "name": "Internal software development",
        "description": "Agile build with discovery, build, QA and deployment.",
        "project_type": ProjectType.AGILE,
        "structure": {
            "epics": [
                {"title": "Discovery", "milestones": [{"title": "Requirements baselined", "offset_days": 10}]},
                {"title": "Build", "milestones": [{"title": "MVP ready", "offset_days": 45}]},
                {"title": "QA", "milestones": [{"title": "Release candidate", "offset_days": 60}]},
                {"title": "Deployment", "milestones": [{"title": "Production release", "offset_days": 70}]},
            ],
        },
    },
    {
        "key": "general-business",
        "name": "General business project",
        "description": "Lightweight project with kickoff, midpoint and completion milestones.",
        "project_type": ProjectType.MILESTONE,
        "structure": {
            "milestones": [
                {"title": "Kickoff", "offset_days": 0},
                {"title": "Midpoint review", "offset_days": 30},
                {"title": "Completion", "offset_days": 60},
            ],
        },
    },
]


class Command(BaseCommand):
    help = "Seed the 6 launch project templates (PRD §10.6)."

    def handle(self, *args, **options):
        count = 0
        for t in TEMPLATES:
            ProjectTemplate.objects.update_or_create(
                key=t["key"],
                defaults={
                    "name": t["name"],
                    "description": t["description"],
                    "project_type": t["project_type"],
                    "default_confidentiality": Confidentiality.OPEN,
                    "structure": t["structure"],
                    "is_active": True,
                },
            )
            count += 1
        self.stdout.write(self.style.SUCCESS(f"Seeded {count} project templates."))
