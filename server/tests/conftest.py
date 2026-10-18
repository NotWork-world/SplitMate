"""Test setup: migrate a fresh database with Alembic (tests the migrations too)."""

import os
import tempfile
import uuid
from datetime import date
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="splitmate-test-"))
os.environ.setdefault("SPLITMATE_DATABASE_URL", f"sqlite:///{(_tmp / 'test.db').as_posix()}")
os.environ["SPLITMATE_ENV"] = "test"
os.environ["SPLITMATE_STORAGE_DIR"] = str(_tmp / "storage")
os.environ["SPLITMATE_AUTH_RATE_LIMIT_PER_MINUTE"] = "0"
os.environ["SPLITMATE_RATE_LIMIT_PER_MINUTE"] = "0"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

SERVER = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated():
    cfg = Config(str(SERVER / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER / "alembic"))
    cfg.attributes["database_url"] = get_settings().database_url
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    yield cfg


@pytest.fixture(autouse=True)
def clean_db(migrated):
    yield
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
        if conn.dialect.name == "sqlite":
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


class Api:
    """Tiny helper: a signed-in user making requests."""

    def __init__(self, client: TestClient, name: str):
        self.client = client
        self.email = f"{name.lower().replace(' ', '.')}-{uuid.uuid4().hex[:6]}@example.com"
        r = client.post("/api/auth/register", json={"email": self.email, "password": "correct-horse-9", "display_name": name})
        assert r.status_code == 201, r.text
        body = r.json()
        self.token = body["access_token"]
        self.refresh = body["refresh_token"]
        self.user = body["user"]

    def h(self, **extra):
        return {"Authorization": f"Bearer {self.token}", **extra}

    def get(self, url, **kw):
        return self.client.get("/api" + url, headers=self.h(), **kw)

    def post(self, url, json=None, headers=None, **kw):
        return self.client.post("/api" + url, json=json, headers=self.h(**(headers or {})), **kw)

    def put(self, url, json=None, **kw):
        return self.client.put("/api" + url, json=json, headers=self.h(), **kw)

    def patch(self, url, json=None, **kw):
        return self.client.patch("/api" + url, json=json, headers=self.h(), **kw)

    def delete(self, url, **kw):
        return self.client.delete("/api" + url, headers=self.h(), **kw)


@pytest.fixture
def make_user(client):
    return lambda name="Asha": Api(client, name)


def expense_body(payer_member_id, items, **extra):
    body = {
        "title": "Dinner",
        "category": "food",
        "expense_date": date(2026, 10, 1).isoformat(),
        "currency": "INR",
        "items": items,
        "payers": [{"member_id": str(payer_member_id)}],
    }
    body.update(extra)
    return body


def item(client_id, name, price, consumers, **extra):
    d = {
        "client_id": client_id,
        "name": name,
        "unit_price_minor": price,
        "consumers": [{"member_id": str(c)} if not isinstance(c, dict) else c for c in consumers],
    }
    d.update(extra)
    return d
