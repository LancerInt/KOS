# KOS

Enterprise Project &amp; Operations Management System for Kriya.

Implements the **KriyaFlow EPOMS Master PRD &amp; SRS v2.0** (27 July 2026).

- **Frontend:** React 18 + TypeScript + Vite + Material UI + Redux Toolkit (PWA)
- **Backend:** Django 5 + Django REST Framework + JWT + Celery
- **Data:** PostgreSQL + Redis + object storage
- **Delivery:** Docker Compose (dev) → cloud-hosted containers (prod)
- **Design:** "Ink &amp; Flow" — calm operational UI, teal brand, Flow Rail signature

## Architecture principle

> **Shared engine, configured modules.** Five core engines (Project, Task, Document,
> Reporting, User/Role) are written once; the 11 department modules *configure* them —
> they are never rebuilt. See PRD §10 and §34.

## Build plan (generation modules)

| # | Module | Status |
|---|--------|--------|
| 0 | Scaffold &amp; Infrastructure | ✅ done |
| 1 | Auth + Dynamic RBAC | ✅ done |
| 2 | Project Engine | ✅ done |
| 3 | Task Engine | ✅ done |
| 4 | Workflow Engine | ✅ done |
| 5 | Agile &amp; Sprints | ✅ done |
| 6 | Dependencies &amp; Blockers | ✅ done |
| 7 | Approvals | ✅ done |
| 8 | Notifications &amp; Escalation | ✅ done |
| 9 | Registers (Risk/Issue/Decision) | ✅ done |
| 10 | Documents &amp; SOP | ✅ done |
| 11 | Search, Reports &amp; Dashboards | ✅ done |
| 12 | Automation Engine | ✅ done |
| 13 | Audit &amp; Compliance | ✅ done |
| 14 | ERP Integration | ✅ done |
| 15 | Offline PWA (Phase 1) | ✅ done |
| 16 | Department Modules (CRM + EPA first) | ✅ done |
| 17 | Testing &amp; Deployment | ✅ done |
| 18 | AI Automation (assistant, per-module AI, scheduled automations) | ✅ done |

## Quick start (Docker — recommended)

```bash
# 1. Copy env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 2. Bring the stack up
docker compose up --build

# 3. In another terminal, initialise the database
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_roles      # 8 default template roles (§6.2)
docker compose exec backend python manage.py seed_templates  # 6 project templates (§10.6)
docker compose exec backend python manage.py seed_retention   # default retention policies (§26.4)
docker compose exec backend python manage.py createsuperuser
```

- Frontend:     http://localhost:5173/
- Backend API:  http://localhost:8000/api/
- Health check: http://localhost:8000/api/health/
- API docs:     http://localhost:8000/api/docs/
- Django admin: http://localhost:8000/admin/

Notification scans (2-day reminder, 48h acknowledgement, daily digest) run via
Celery beat, or on demand: `docker compose exec backend python manage.py notify_scan`.

## AI automation (`apps.ai`)

An AI assistant, per-module AI actions, and scheduled automations that detect
overdue work and escalate it.

### Provider abstraction

Every module calls `apps.ai.service` — never a vendor SDK. A provider implements
one primitive (the raw chat call) and inherits the whole ERP vocabulary
(`summarize`, `chat`, `generate_email`, `analyse_tasks`, `analyse_project`,
`generate_notifications`, `create_tasks_from_notes`) from `AIProvider`.

Supported providers: **Groq**, **Grok (xAI)**, **OpenAI**, and an offline stub.
(Groq and Grok are different companies with confusingly similar names.)

**Switching vendor is a config change, never a code change:**

```bash
AI_PROVIDER=groq     # or grok | openai | mock
GROQ_API_KEY=gsk_...
```

Adding a vendor is one subclass plus one registry line — Groq was added that
way in ~20 lines. The prompts, JSON contracts and business logic are
vendor-independent by construction, so no ERP module changes.

### Configuration

The API key is read from the server environment only. It is never stored in the
database, never returned by the API, and never reaches the browser — the
frontend always calls Django, and Django calls the provider.

```bash
GROQ_API_KEY=gsk-...          # match the key to whichever AI_PROVIDER names
```

**With no key set, nothing breaks.** The system falls back to an offline
provider that answers locally in the correct JSON shape, so every screen is
usable in development and the test suite never makes a network call. The UI says
plainly when it is doing this.

Everything else — provider, model, temperature, automation toggles, escalation
timings and rate caps — is runtime configuration at **Platform → AI Automation**
(administrators only), which also shows usage and the automation audit trail.

### Scheduled automations

| Cadence | Task | What it does |
|---|---|---|
| 5 min | `scan_overdue_tasks` | Detects overdue work; walks the reminder → escalation ladder |
| 15 min | `scan_blocked_and_priority` | Blocked tasks, critical work, SLA breaches |
| 4 hours | `scan_missed_milestones` | Flags milestones whose date passed unreached |
| Hourly | `scan_project_health` | Health scoring; alerts on projects turning critical |
| Daily 08:00 | `generate_daily_summaries` | Personal briefing email per user |
| Mon 08:30 | `generate_weekly_reports` | Team report to leadership |
| 1st 09:00 | `generate_monthly_reports` | KPI / productivity / executive summary |
| 20 min | `retry_failed_emails` | Re-sends outbound mail that hit a transient SMTP failure |
| on save | `alert_critical_task` | Emails owners the moment a task reaches a critical stage |

The escalation ladder: overdue detected → owner reminded → reminded again after
30 min → manager notified after 2 h → escalated to leadership after 24 h (all
configurable). `TaskEscalation` makes the 5-minute scan idempotent, so a task
overdue for a week produces four messages, not two thousand.

Run them without a worker:

```bash
docker compose exec backend python manage.py ai_scan          # recurring scans
docker compose exec backend python manage.py ai_scan --all    # plus daily/weekly/monthly
```

### Sending email (`apps.ai.outbound`)

Two things send mail out of KOS, and both go through one audited path.

**Drafts a user sends.** "Generate email" produces a draft; the compose dialog
lets the user edit it, add **Cc** and **Bcc**, and press Send. Drafting
(`POST /api/ai/generate-email/`) and sending (`POST /api/ai/send-email/`) are
separate endpoints on purpose — generating is free to repeat and changes
nothing, sending is irreversible. The only way to reach the send endpoint is to
post the approved text back, which is what guarantees nothing is ever sent
unread.

**Critical-stage alerts.** A task *crossing into* a critical stage emails its
owners immediately, without waiting for the next scan. A crossing means: raised
to critical priority, flagged as a critical risk, critical/high work becoming
blocked or on hold, or a critical task passing its due date. Owners are on To,
project management on Cc, and a configurable watch-list on **Bcc** so a shared
operations mailbox can see every alert without appearing in the team's
reply-all. Re-saving an already-critical task sends nothing, and a per-task
cooldown (default 12 h) stops a triage session becoming a mail storm.

Every message — including its Bcc list — is stored as an `OutboundEmail` row
with its delivery outcome, visible at **Django admin → Outbound emails** and
over `GET /api/ai/emails/`. Guard rails: kill switches for automated and
user-sent mail separately, a per-user hourly cap, a per-message recipient cap,
and header-injection stripping on every address and subject.

**Gmail** is configuration, not code — point the standard Django SMTP settings
at it:

```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=kos@your-domain.com
EMAIL_HOST_PASSWORD=<16-character app password>
DEFAULT_FROM_EMAIL=KOS <kos@your-domain.com>
```

Gmail requires an [app password](https://myaccount.google.com/apppasswords)
(2-Step Verification must be on) and rewrites `From` to the authenticated
account. KOS therefore sets `Reply-To` to the person who sent the message, so
replies reach them rather than a no-reply mailbox.

### Design guarantees

- **Nothing is written to the ERP without confirmation.** Generation endpoints
  return previews; separate endpoints (`apply-subtasks`, `create-tasks`) write.
- **AI never widens access.** Every endpoint resolves its subject through the
  same `visible_projects` rules as the rest of KOS.
- **An AI outage degrades, it does not break.** Requests return 503 with a
  readable message; scheduled reminders still go out using templated copy.
- **Everything is logged.** `AIRequestLog` records every provider call (tokens,
  latency, errors); `AIAutomationLog` records every automated decision — what
  the AI said, who was notified, and whether it worked.

## Local (without Docker)

Requires PostgreSQL and Redis running locally.

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # PowerShell
pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
python manage.py seed_roles
python manage.py seed_templates
python manage.py seed_retention
python manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Testing &amp; linting

```bash
cd backend
pytest                 # runs app tests + the integration suite (tests/)
ruff check .           # lint
```

Tests use a Postgres test database, so Postgres must be running (or use the
Docker stack). The suite covers the load-bearing paths: RBAC visibility (§7),
Definition-of-Done gating (§11.5), and offline-sync idempotency (§25).

CI runs on every push/PR via [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
lint, a migrations-completeness check, the backend test suite, and the frontend
type-check &amp; build.

## Production deployment

Uses [`docker-compose.prod.yml`](docker-compose.prod.yml) — the backend runs
under gunicorn, the frontend is built to static files and served by nginx (which
also proxies `/api` and `/media`), and Celery worker + beat run the scheduled
scans (daily reminders/digest, webhook retries every 10 min, weekly retention
purge).

```bash
# 1. Configure secrets
cp backend/.env.prod.example .env      # then edit .env with real values

# 2. Build & start
docker compose -f docker-compose.prod.yml up -d --build
# (backend auto-runs migrate + collectstatic on start)

# 3. First-run seed data + admin
docker compose -f docker-compose.prod.yml exec backend python manage.py seed_roles
docker compose -f docker-compose.prod.yml exec backend python manage.py seed_templates
docker compose -f docker-compose.prod.yml exec backend python manage.py seed_retention
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

The app is then served on port 80. Put a TLS-terminating reverse proxy / load
balancer in front (set `SECURE_SSL_REDIRECT=True`, already the default in prod).

**Backups:** the Postgres data and uploaded media live in named volumes
(`pgdata`, `media`). Schedule `pg_dump` of the `kos` database and snapshot the
media volume. Audit and regulatory records are retention-exempt (§26.4), so they
are never purged.

## Repository layout

```
KOS/
├── backend/            Django REST API
│   ├── config/         Settings, urls, wsgi/asgi, celery
│   └── apps/
│       ├── core/       Health, shared base models
│       ├── accounts/   Custom user (RBAC added in Module 1)
│       └── ai/         AI automation
│           ├── providers/  AIProvider interface + Grok / OpenAI / offline
│           ├── prompts.py  System prompts (no vendor references)
│           ├── schemas.py  JSON contracts shared by every provider
│           ├── service.py  The only entry point ERP modules use
│           └── tasks.py    Celery scans, escalation ladder, reports
├── frontend/           React + Vite PWA
│   └── src/            theme (Ink & Flow), store, api client, App shell
│       └── features/ai/    Assistant drawer, AI action buttons, result renderer
└── docker-compose.yml  Dev stack (db, redis, backend, celery, frontend)
```
