"""System prompts and prompt builders.

Prompts live in one module so the *behaviour* of the assistant is reviewable in
a single place, and so swapping providers cannot quietly change what the ERP
asks for. Nothing here mentions a vendor.
"""
from __future__ import annotations

import json
from typing import Any

PRODUCT = "KOS (Kriya Operations System), an enterprise project & operations ERP"

BASE_SYSTEM = (
    f"You are the AI assistant built into {PRODUCT}. "
    "You help project managers, engineers and department teams run their work. "
    "Be concise, specific and practical. Base every statement on the data you are given — "
    "if the data does not support a conclusion, say so rather than inventing detail. "
    "Never fabricate names, dates, numbers or identifiers."
)

CHAT_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You are answering in a chat panel docked inside the app. Keep answers short and "
    "scannable — a few sentences or a short list. Use markdown for structure. "
    "When the user asks about something not present in the supplied context, say what you "
    "would need to answer, and suggest the screen in KOS where it lives."
)

SUMMARIZE_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You are summarising ERP content. Preserve concrete specifics: owners, dates, statuses, "
    "blockers and numbers. Drop pleasantries and repetition."
)

EMAIL_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You draft internal and external business email for this organisation. Write complete, "
    "ready-to-send copy — no placeholders like [Name] unless the name is genuinely unknown. "
    "Keep it courteous and direct; no more than four short paragraphs."
)

ANALYSIS_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You are a delivery analyst. Judge status from evidence: due dates versus today, overdue "
    "counts, blocked work, unassigned work, stalled items and progress against milestones. "
    "Be honest about bad news — an over-optimistic report is a failed report. "
    "Only suggest an assignee whose name appears in the supplied people list."
)

NOTIFICATION_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You write the copy for automated reminders and escalations. Respect the escalation stage "
    "you are told about: a first reminder is a light nudge, a manager notification is factual "
    "and neutral, an escalation is firm and states the business impact. "
    "Never threaten, blame an individual, or invent consequences."
)

EXTRACTION_SYSTEM = (
    f"{BASE_SYSTEM}\n"
    "You extract structured, actionable work from unstructured notes. Only create a task when "
    "the notes genuinely imply an action someone must take. Do not invent owners or dates — "
    "leave them empty when unstated. Write task titles in the imperative."
)


def json_instruction(schema: dict[str, Any]) -> str:
    """Append the required output shape to a system prompt."""
    return (
        "Respond with a single valid JSON object and nothing else — no prose, no code fences, "
        "no explanation before or after. Use exactly these keys, matching this shape:\n"
        f"{json.dumps(schema, indent=2)}\n"
        "Every key must be present. Use an empty string or empty list when you have nothing to "
        "put there. Where a value description says 'one of', use exactly one of those values."
    )


def _section(label: str, body: str) -> str:
    body = (body or "").strip()
    return f"\n\n### {label}\n{body}" if body else ""


# --------------------------------------------------------------------------- #
# Builders for the seven core operations
# --------------------------------------------------------------------------- #
def summarize_prompt(text: str, *, style: str, audience: str, instructions: str) -> str:
    return (
        f"Summarise the following for {audience}. Style: {style}."
        + _section("Extra instructions", instructions)
        + _section("Content", text)
    )


def chat_prompt(message: str, *, context: str) -> str:
    return _section("Context from the user's current screen", context).lstrip("\n") + (
        f"\n\n### User question\n{message}" if context else message
    )


def email_prompt(purpose: str, *, context: str, tone: str, recipient: str, sender: str, language: str) -> str:
    return (
        f"Draft an email in {language}. Tone: {tone}."
        + _section("Purpose", purpose)
        + _section("Recipient", recipient)
        + _section("Sender", sender)
        + _section("Supporting data", context)
    )


def analyse_tasks_prompt(tasks_context: str, *, goal: str) -> str:
    return (
        "Analyse the tasks below. For each task judge urgency and the priority it should carry, "
        "suggest an owner where one is missing, and name any follow-up work that is clearly implied."
        + _section("Objective", goal)
        + _section("Tasks", tasks_context)
    )


def analyse_project_prompt(project_context: str, *, goal: str) -> str:
    return (
        "Analyse this project's health. Score it 0-100, identify the real risks, predict whether "
        "it will slip and by roughly how many days, and recommend what to do next."
        + _section("Objective", goal)
        + _section("Project data", project_context)
    )


def notifications_prompt(events_context: str, *, audience: str) -> str:
    return (
        "Write the notification and email copy for each event below. One entry per event, "
        "keeping the reference id so the system can route it."
        + _section("Audience", audience)
        + _section("Events", events_context)
    )


def tasks_from_notes_prompt(notes: str, *, context: str) -> str:
    return (
        "Read these notes and extract the decisions made and the tasks that must now be created."
        + _section("Context", context)
        + _section("Notes", notes)
    )
