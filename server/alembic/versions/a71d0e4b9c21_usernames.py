"""usernames: a public handle so friends can add each other

Revision ID: a71d0e4b9c21
Revises: f3c5c2968387
Create Date: 2026-10-18
"""
import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a71d0e4b9c21"
down_revision: Union[str, Sequence[str], None] = "f3c5c2968387"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("username", sa.String(length=20), nullable=True))
        b.create_unique_constraint("uq_users_username", ["username"])
    # Give existing accounts a handle now so friends can find them straight away.
    conn = op.get_bind()
    taken: set[str] = set()
    rows = conn.execute(sa.text("SELECT id, display_name FROM users WHERE deleted_at IS NULL ORDER BY created_at")).fetchall()
    for uid, name in rows:
        base = re.sub(r"[^a-z0-9]+", "_", (name or "").lower())[:14].strip("_") or "user"
        if len(base) < 3:
            base = f"{base}_sm"
        candidate, n = base, 1
        while candidate in taken:
            n += 1
            candidate = f"{base}{n}"
        taken.add(candidate)
        conn.execute(sa.text("UPDATE users SET username = :u WHERE id = :id"), {"u": candidate, "id": uid})


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_constraint("uq_users_username", type_="unique")
        b.drop_column("username")
