"""The JSON contracts the AI must answer with.

These are *example documents*, not JSON Schema: they are embedded verbatim in
the system prompt, which is the one technique that works identically on every
vendor (including ones with no structured-output mode). Values describe the
expected type or allowed set.

Changing a shape here changes it for every provider at once — which is the
point. The ERP parses these keys, so treat them as an API.
"""
from __future__ import annotations

URGENCY = "one of: low | normal | high | critical"
PRIORITY = "one of: low | medium | high | critical"
RISK = "one of: low | medium | high | critical"

SUMMARY = {
    "summary": "2-4 sentence plain-English summary",
    "key_points": ["short bullet", "..."],
    "action_items": ["concrete next action", "..."],
    "sentiment": "one of: positive | neutral | concerning",
}

EMAIL = {
    "subject": "email subject line, under 80 characters",
    "body": "full email body as plain text, with greeting and sign-off",
    "urgency": URGENCY,
    "tone": "the tone actually used",
}

TASK_ANALYSIS = {
    "summary": "overall assessment of this set of tasks",
    "risks": ["risk description", "..."],
    "recommendations": ["actionable recommendation", "..."],
    "tasks": [
        {
            "id": "the task id exactly as given",
            "urgency": URGENCY,
            "suggested_priority": PRIORITY,
            "suggested_assignee": "name from the provided people list, or empty string",
            "reason": "one sentence explaining the assessment",
            "follow_up_tasks": ["title of a follow-up task worth creating", "..."],
        }
    ],
}

PROJECT_ANALYSIS = {
    "summary": "3-5 sentence status narrative for a manager",
    "health_score": "integer 0-100, where 100 is perfectly healthy",
    "health_label": "one of: on_track | at_risk | off_track",
    "risk_level": RISK,
    "risks": [
        {
            "title": "short risk name",
            "severity": RISK,
            "impact": "what happens if unaddressed",
            "mitigation": "recommended action",
        }
    ],
    "delay_prediction": {
        "will_be_delayed": "true or false",
        "estimated_delay_days": "integer, 0 if none expected",
        "confidence": "one of: low | medium | high",
        "reasoning": "why",
    },
    "recommendations": ["actionable recommendation", "..."],
    "next_actions": ["the single most useful next step", "..."],
}

NOTIFICATIONS = {
    "notifications": [
        {
            "reference": "the event id exactly as given",
            "title": "notification title, under 120 characters",
            "message": "in-app notification body, 1-2 sentences",
            "email_subject": "email subject line",
            "email_body": "email body as plain text",
            "urgency": URGENCY,
            "recommended_action": "what the recipient should do now",
        }
    ]
}

TASKS_FROM_NOTES = {
    "summary": "what this discussion was about, 2-4 sentences",
    "decisions": ["a decision that was made", "..."],
    "tasks": [
        {
            "title": "imperative task title, under 120 characters",
            "description": "what needs doing and why",
            "deliverable": "what 'done' produces",
            "priority": PRIORITY,
            "owner_hint": "name mentioned as responsible, or empty string",
            "due_in_days": "integer number of days from today, 0 if unstated",
            "subtasks": ["smaller step", "..."],
        }
    ],
    "open_questions": ["question left unresolved", "..."],
}

# --- shapes used by the feature endpoints (built on the same primitives) --- #
REWRITE = {
    "text": "the rewritten text",
    "changes": ["what was changed and why", "..."],
}

SUBTASKS = {
    "subtasks": [
        {
            "title": "imperative subtask title",
            "reason": "why this step is needed",
            "order": "integer, 1-based execution order",
        }
    ]
}

ESTIMATE = {
    "estimated_hours": "integer best-guess effort in hours",
    "range_low_hours": "integer optimistic estimate",
    "range_high_hours": "integer pessimistic estimate",
    "confidence": "one of: low | medium | high",
    "assumptions": ["assumption behind the estimate", "..."],
    "reasoning": "one paragraph explaining the estimate",
}

PRIORITIZE = {
    "suggested_priority": PRIORITY,
    "suggested_risk_level": RISK,
    "reasoning": "why this priority",
    "recommended_order": ["task title or id in the order they should be tackled", "..."],
}

MEETING = {
    "summary": "what the meeting covered",
    "decisions": ["decision made", "..."],
    "action_items": [
        {"action": "what must happen", "owner": "who, or empty string", "due_in_days": "integer, 0 if unstated"}
    ],
    "attendees": ["name mentioned as present", "..."],
    "open_questions": ["unresolved question", "..."],
}

CUSTOMER_SUMMARY = {
    "summary": "who this customer is and where the relationship stands",
    "relationship_health": "one of: strong | steady | at_risk",
    "open_value": "total open opportunity value as a number, 0 if unknown",
    "highlights": ["notable fact", "..."],
    "risks": ["relationship or deal risk", "..."],
    "next_actions": ["recommended next step with this customer", "..."],
}

PROPOSAL = {
    "title": "proposal title",
    "executive_summary": "2-3 paragraph summary",
    "sections": [{"heading": "section heading", "content": "section body"}],
    "pricing_notes": "commercial notes, or empty string",
    "next_steps": ["step", "..."],
}

JOB_DESCRIPTION = {
    "title": "job title",
    "summary": "role summary paragraph",
    "responsibilities": ["responsibility", "..."],
    "required_qualifications": ["requirement", "..."],
    "preferred_qualifications": ["nice to have", "..."],
    "skills": ["skill", "..."],
    "experience_level": "e.g. 3-5 years",
}

PERFORMANCE_SUMMARY = {
    "summary": "balanced performance narrative",
    "strengths": ["strength backed by the data", "..."],
    "areas_for_improvement": ["development area", "..."],
    "achievements": ["notable delivery", "..."],
    "recommendations": ["coaching or development recommendation", "..."],
    "overall_rating": "one of: exceptional | strong | solid | needs_improvement",
}

INSIGHTS = {
    "headline": "the single most important thing to know right now",
    "insights": [
        {
            "title": "short insight title",
            "detail": "what the numbers show and why it matters",
            "severity": "one of: info | warning | critical",
        }
    ],
    "recommendations": ["what to do today", "..."],
    "trends": ["observed trend", "..."],
}

REPORT = {
    "title": "report title",
    "executive_summary": "3-5 sentence summary for leadership",
    "sections": [{"heading": "section heading", "content": "section body as plain text"}],
    "metrics_commentary": "what the numbers say",
    "risks": ["risk needing attention", "..."],
    "recommendations": ["recommendation", "..."],
}

EXPLAIN = {
    "explanation": "plain-English explanation of what these figures mean",
    "key_takeaways": ["takeaway", "..."],
    "watch_outs": ["something to keep an eye on", "..."],
}

TRANSLATE = {
    "text": "the translated text",
    "detected_source_language": "language detected in the input",
}

DUPLICATES = {
    "duplicates": [
        {
            "id": "task id exactly as given",
            "duplicate_of": "the other task id",
            "confidence": "one of: low | medium | high",
            "reason": "why they look like the same work",
        }
    ]
}

WORKLOAD = {
    "summary": "how work is distributed across the team",
    "overloaded": [{"person": "name", "reason": "why", "suggested_moves": ["task to reassign", "..."]}],
    "underutilised": [{"person": "name", "capacity_note": "what they could take on"}],
    "burnout_risks": [{"person": "name", "severity": RISK, "signals": ["signal", "..."]}],
    "recommendations": ["rebalancing recommendation", "..."],
}

# A new workspace's identity (a top-level area of operations). The ERP creates
# it via the normal workspace endpoint after the user confirms.
WORKSPACE_META = {
    "label": "a short workspace name under 40 characters",
    "blurb": "a one-line description of the workspace",
    "icon": "one icon keyword, exactly from the provided list",
    "accent": "one hex colour, exactly from the provided list",
}

# A project structure to scaffold inside a workspace: a project name plus
# sections, each a form with typed fields. The ERP creates these via the normal
# project/section endpoints once the user confirms.
WORKSPACE_SCAFFOLD = {
    "project_name": "a short, clear project name under 80 characters",
    "sections": [
        {
            "name": "section name under 60 characters",
            "blurb": "one-line description of the section, or empty string",
            "fields": [
                {
                    "type": "one of: text | paragraph | dropdown | radio | checkbox | number | date | file",
                    "label": "field label under 60 characters",
                    "required": "true or false",
                    "options": ["2-6 choices for dropdown/radio/checkbox; empty list for other types"],
                }
            ],
        }
    ],
}
