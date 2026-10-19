"""users.upi_qr: keep the person's own UPI QR text exactly

Revision ID: b3e9f1c2d4a5
Revises: a71d0e4b9c21
Create Date: 2026-10-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3e9f1c2d4a5"
down_revision: Union[str, Sequence[str], None] = "a71d0e4b9c21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("upi_qr", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_column("upi_qr")
