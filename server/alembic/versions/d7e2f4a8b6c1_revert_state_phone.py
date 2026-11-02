"""'revert' repayment state + users.phone

Revision ID: d7e2f4a8b6c1
Revises: c5d1a7e3f9b2
Create Date: 2026-11-02

- repayments gains the REVERTED state (a confirmed payment that never arrived
  can be undone by the recipient, appending a reversal ledger entry).
- users gains an optional phone, shown to group members for WhatsApp nudges.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7e2f4a8b6c1"
down_revision: Union[str, Sequence[str], None] = "c5d1a7e3f9b2"
branch_labels = None
depends_on = None

NEW_STATUS = (
    "status in ('REQUESTED','MARKED_SENT','AWAITING_CONFIRMATION',"
    "'CONFIRMED','DISPUTED','CANCELLED','REJECTED','REVERTED')"
)
OLD_STATUS = (
    "status in ('REQUESTED','MARKED_SENT','AWAITING_CONFIRMATION',"
    "'CONFIRMED','DISPUTED','CANCELLED','REJECTED')"
)


def _repayments(status_check: str) -> sa.Table:
    """The full repayments table: batch rebuilds on SQLite must keep every constraint."""
    return sa.Table(
        "repayments",
        sa.MetaData(),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("debtor_member_id", sa.Uuid(), nullable=False),
        sa.Column("creditor_member_id", sa.Uuid(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("note", sa.String(length=280), nullable=True),
        sa.Column("reference", sa.String(length=80), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(status_check, name="ck_repayments_status"),
        sa.CheckConstraint("amount_minor > 0", name="ck_repayments_amount_positive"),
        sa.CheckConstraint("debtor_member_id <> creditor_member_id", name="ck_repayments_distinct_parties"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_repayments_created_by_users", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["creditor_member_id"], ["group_members.id"], name="fk_repayments_creditor_member_id_group_members", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["debtor_member_id"], ["group_members.id"], name="fk_repayments_debtor_member_id_group_members", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], name="fk_repayments_group_id_groups", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_repayments"),
    )


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=20), nullable=True))
    with op.batch_alter_table("repayments", copy_from=_repayments(OLD_STATUS)) as batch:
        batch.drop_constraint("status", type_="check")
        batch.create_check_constraint("status", NEW_STATUS)


def downgrade() -> None:
    with op.batch_alter_table("repayments", copy_from=_repayments(NEW_STATUS)) as batch:
        batch.drop_constraint("status", type_="check")
        batch.create_check_constraint("status", OLD_STATUS)
    op.drop_column("users", "phone")
