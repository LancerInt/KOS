"""
Django settings for KOS.

Configuration is environment-driven (PRD §34 principle 3: "configuration over code").
Values are read from environment variables / a local .env file via django-environ.
"""
from datetime import timedelta
from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1", "backend"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173", "http://127.0.0.1:5173"]),
)

# Read .env if present (local dev). In Docker/prod, real env vars take precedence.
env_file = BASE_DIR / ".env"
if env_file.exists():
    environ.Env.read_env(str(env_file))

# --------------------------------------------------------------------------- #
# Core
# --------------------------------------------------------------------------- #
SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-secret-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "django_celery_beat",
    # Local apps
    "apps.core",
    "apps.audit",
    "apps.accounts",
    "apps.projects",
    "apps.tasks",
    "apps.workflows",
    "apps.agile",
    "apps.dependencies",
    "apps.approvals",
    "apps.notifications",
    "apps.registers",
    "apps.documents",
    "apps.reports",
    "apps.automation",
    "apps.integrations",
    "apps.sync",
    "apps.crm",
    "apps.regulatory",
    "apps.workspaces",
]

# Custom user model — set in Phase 0 so it exists before the first migration
# (Django cannot swap AUTH_USER_MODEL later without pain). Module 1 extends it
# with dynamic roles, capabilities and MFA (PRD §7, §10.5, §32).
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --------------------------------------------------------------------------- #
# Database (PostgreSQL) — PRD §33.3
# --------------------------------------------------------------------------- #
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://kos:kos@localhost:5432/kos",
    )
}

# --------------------------------------------------------------------------- #
# Cache / Celery (Redis) — PRD §31.4
# --------------------------------------------------------------------------- #
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=REDIS_URL)
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TASK_TRACK_STARTED = True
CELERY_TIMEZONE = "Asia/Kolkata"

# Scheduled jobs (installed into the DB scheduler on beat startup).
# All reminder/digest scans run once a day; webhook delivery retries run often;
# the retention purge runs weekly (destructive, so kept on its own cadence).
CELERY_BEAT_SCHEDULE = {
    "daily-scans": {
        "task": "apps.notifications.tasks.run_all_scans",
        "schedule": crontab(hour=7, minute=0),
    },
    "webhook-delivery-retries": {
        "task": "apps.integrations.tasks.retry_pending_deliveries",
        "schedule": crontab(minute="*/10"),
    },
    "weekly-retention-purge": {
        "task": "apps.audit.tasks.purge_expired_records",
        "schedule": crontab(hour=3, minute=30, day_of_week="sun"),
    },
}

# --------------------------------------------------------------------------- #
# Password validation
# --------------------------------------------------------------------------- #
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------- #
# Internationalisation
# --------------------------------------------------------------------------- #
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------- #
# Static & media
# --------------------------------------------------------------------------- #
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------- #
# Django REST Framework — PRD §7.7 (server-authoritative permissions), §31.4
# --------------------------------------------------------------------------- #
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,       # PRD §32: refresh token rotation
    "BLACKLIST_AFTER_ROTATION": True,    # invalidate rotated refresh tokens
}

# Roles whose users must use MFA (PRD §32). Matched by Role.name in Module 1.
PRIVILEGED_ROLE_NAMES = ["Administrator", "IT Team", "Management (MD / Director)"]

# TOTP issuer shown in authenticator apps.
MFA_ISSUER = "KOS"

SPECTACULAR_SETTINGS = {
    "TITLE": "KOS API",
    "DESCRIPTION": "Kriya Operations — Enterprise Project & Operations Management REST API.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --------------------------------------------------------------------------- #
# CORS — PRD §33 (React PWA talks to the API cross-origin in dev)
# --------------------------------------------------------------------------- #
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# --------------------------------------------------------------------------- #
# Email (PRD §22 / D1). Console backend in dev; SMTP configured via env in prod.
# --------------------------------------------------------------------------- #
if env("EMAIL_HOST", default=""):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = env("EMAIL_HOST")
    EMAIL_PORT = env.int("EMAIL_PORT", default=587)
    EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
    EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@kos.local")
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:5173")

# --------------------------------------------------------------------------- #
# Security (tightened in prod via env) — PRD §31.1, §32
# --------------------------------------------------------------------------- #
if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --------------------------------------------------------------------------- #
# Logging — PRD §31.2 (error logging)
# --------------------------------------------------------------------------- #
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "{levelname} {asctime} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
