"""Shares in thousandths: ½ = 500, 2 = 2000.

Item shares were stored as whole numbers (1, 2, 3…). They now live in thousandths so a
person can have ½ or ¼ of something (the "8 rotis, 4 people" case). Existing shares-mode
consumers are lifted to the new scale; percent (basis points) and exact (minor units)
modes are untouched, and proportional allocation means the money split itself is unchanged.

Revision ID: e8b4a1c6d9f2
Revises: d7e2f4a8b6c1
"""

from alembic import op

revision = "e8b4a1c6d9f2"
down_revision = "d7e2f4a8b6c1"


def upgrade() -> None:
    op.execute(
        "UPDATE item_consumers SET value = value * 1000 "
        "WHERE item_id IN (SELECT id FROM expense_items WHERE split_mode = 'shares')"
    )


def downgrade() -> None:
    # Whole thousandths go back to whole shares; a truly fractional share (e.g. 250)
    # can't be expressed in the old scale, so it keeps its thousandths value.
    op.execute(
        "UPDATE item_consumers SET value = value / 1000 "
        "WHERE item_id IN (SELECT id FROM expense_items WHERE split_mode = 'shares') AND value % 1000 = 0"
    )
