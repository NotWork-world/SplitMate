"""Every account gets a username (mandatory handle for finding people)

Revision ID: f2a9c3e7b5d1
Revises: e8b4a1c6d9f2
Create Date: 2026-11-04

The first username migration backfilled the accounts that existed then, but
anyone who signed up through a path that didn't assign one yet has none -
and /me/people only shows users WITH a username, so friends like them
silently disappear from the people list. This sweeps the rest.
"""
import re
import uuid

import sqlalchemy as sa
from alembic import op

revision: str = "f2a9c3e7b5d1"
down_revision = "e8b4a1c6d9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    taken = {row[0] for row in conn.execute(sa.text("SELECT username FROM users WHERE username IS NOT NULL")).fetchall()}
    rows = conn.execute(
        sa.text("SELECT id, display_name, email FROM users WHERE username IS NULL ORDER BY created_at")
    ).fetchall()
    for uid, name, email in rows:
        seed = (name or email or "user").split("@")[0]
        base = re.sub(r"[^a-z0-9]+", "_", seed.lower())[:14].strip("_") or "user"
        if len(base) < 3:
            base = f"{base}_sm"
        candidate, n = base, 1
        while candidate in taken:
            n += 1
            candidate = f"{base}{n}"
        if len(candidate) > 20:
            candidate = f"user{uuid.uuid4().hex[:12]}"
        taken.add(candidate)
        conn.execute(sa.text("UPDATE users SET username = :u WHERE id = :id"), {"u": candidate, "id": uid})


def downgrade() -> None:
    pass  # usernames are mandatory; nothing to undo
