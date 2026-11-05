"""app_meta: server bookkeeping (key/value)

Revision ID: b7e3a9c1d5f2
Revises: f2a9c3e7b5d1
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7e3a9c1d5f2"
down_revision: Union[str, Sequence[str], None] = "f2a9c3e7b5d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_meta",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_app_meta")),
    )


def downgrade() -> None:
    op.drop_table("app_meta")
