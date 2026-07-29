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
│       └── accounts/   Custom user (RBAC added in Module 1)
├── frontend/           React + Vite PWA
│   └── src/            theme (Ink & Flow), store, api client, App shell
└── docker-compose.yml  Dev stack (db, redis, backend, celery, frontend)
```
