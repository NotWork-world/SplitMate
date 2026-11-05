from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="SPLITMATE_", extra="ignore")

    env: str = "development"  # development | test | production
    database_url: str = "sqlite:///./splitmate.db"

    # Secrets: must be overridden in production (checked at startup).
    jwt_secret: str = "dev-only-change-me-dev-only-change-me"
    signing_secret: str = "dev-only-signing-secret-change-me"

    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Comma-separated OAuth client IDs whose Google ID tokens we accept
    # (the Android app's web client ID). Empty = Google Sign-In disabled.
    google_client_ids: str = ""

    # Receipts
    storage_backend: str = "local"  # local | s3
    storage_dir: str = "./storage"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = "auto"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    receipt_max_mb: int = 8
    signed_url_seconds: int = 300

    rate_limit_per_minute: int = 120
    auth_rate_limit_per_minute: int = 10
    cors_origins: str = ""
    public_base_url: str = "http://localhost:8000"
    # Phone notifications (Firebase Cloud Messaging): the service-account JSON, as is or base64.
    # Empty = notifications stay in the app only.
    firebase_credentials: str = ""

    # In-app update check, served on /api/health as "app". The phone app compares
    # its own package version against app_latest_version and offers the APK at
    # app_apk_url. Keep BOTH in lockstep with the GitHub release tag (v1.6.0 =
    # mobile package.json "1.6.0" = the version in the update notification).
    app_latest_version: str = "1.6.0"
    app_apk_url: str = (
        "https://github.com/NotWork-world/SplitMate/releases/download/v1.6.0/SplitMate-v1.6.0-arm64.apk"
    )

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        # Neon/Render hand out postgres:// URLs; SQLAlchemy needs a driver name.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://") :]
        return v

    @property
    def google_client_id_list(self) -> list[str]:
        # Real IDs end in ".apps.googleusercontent.com"; placeholders like "none" mean "off".
        return [c.strip() for c in self.google_client_ids.split(",") if c.strip().endswith(".apps.googleusercontent.com")]

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def check_production_safety(self) -> None:
        if not self.is_production:
            return
        problems = []
        if "dev-only" in self.jwt_secret or len(self.jwt_secret) < 32:
            problems.append("SPLITMATE_JWT_SECRET")
        if "dev-only" in self.signing_secret or len(self.signing_secret) < 32:
            problems.append("SPLITMATE_SIGNING_SECRET")
        if self.database_url.startswith("sqlite"):
            problems.append("SPLITMATE_DATABASE_URL (PostgreSQL required)")
        if problems:
            raise RuntimeError("Refusing to start in production without: " + ", ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
