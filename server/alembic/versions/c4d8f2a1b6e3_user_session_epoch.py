"""users.session_epoch: single-device login

Revision ID: c4d8f2a1b6e3
Revises: b7e3a9c1d5f2
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4d8f2a1b6e3"
down_revision: Union[str, Sequence[str], None] = "b7e3a9c1d5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("session_epoch", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "session_epoch")
