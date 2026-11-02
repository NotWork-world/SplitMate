from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..integrations import push
from ..models import ActivityEvent, AuditEvent, GroupMember, Notification, User

# Which preference switch controls which activity type (all default to on).
PREFERENCE_FOR = {
    "expense.finalized": "notify_expenses",
    "expense.updated": "notify_expenses",
    "expense.cancelled": "notify_expenses",
    "repayment.requested": "notify_repayments",
    "repayment.marked_sent": "notify_repayments",
    "repayment.confirmed": "notify_repayments",
    "repayment.rejected": "notify_repayments",
    "repayment.disputed": "notify_repayments",
    "repayment.cancelled": "notify_repayments",
    "repayment.resubmitted": "notify_repayments",
    "repayment.autoconfirmed": "notify_repayments",
    "repayment.reverted": "notify_repayments",
    "repayment.reminder": "notify_repayments",
    "member.joined": "notify_groups",
    "member.added": "notify_groups",
    "member.removed": "notify_groups",
    "group.created": "notify_groups",
}


def record(
    db: Session,
    *,
    actor: User | None,
    type: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    group_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
    notify_member_ids: set[uuid.UUID] | None = None,
) -> ActivityEvent:
    """Write an activity event and in-app notifications for the affected people.

    ``notify_member_ids`` limits notifications to those members (e.g. only the
    two people in a repayment); otherwise every registered member of the group
    except the actor is notified. Users who switched the category off get none.
    """
    event = ActivityEvent(
        group_id=group_id,
        actor_user_id=actor.id if actor else None,
        type=type,
        entity_type=entity_type,
        entity_id=entity_id,
        data=data or {},
    )
    db.add(event)
    db.flush()
    if group_id is None:
        return event
    q = select(GroupMember.user_id).where(
        GroupMember.group_id == group_id, GroupMember.status == "active", GroupMember.user_id.is_not(None)
    )
    if notify_member_ids is not None:
        q = q.where(GroupMember.id.in_(notify_member_ids))
    pref = PREFERENCE_FOR.get(type)
    for user_id in set(db.scalars(q)):
        if actor and user_id == actor.id:
            continue
        if pref:
            user = db.get(User, user_id)
            if user is None or user.deleted_at or (user.preferences or {}).get(pref) is False:
                continue
        db.add(Notification(user_id=user_id, activity_id=event.id))
        push.queue(db, user_id, event.id)
    return event


def audit(
    db: Session, *, actor: User | None, action: str, entity_type: str, entity_id: uuid.UUID | None, data: dict | None = None
) -> None:
    db.add(
        AuditEvent(
            actor_user_id=actor.id if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            data=data or {},
        )
    )
