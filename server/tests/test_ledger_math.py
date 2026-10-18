import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.money import (
    Obligation,
    net_balances,
    obligations_for_expense,
    pairwise_balances,
    settlement_suggestions,
)
from app.money.ledger import LedgerError


def test_single_payer_prompt_example():
    # You pay Rs 1,000.00; your share 500, Rahul 300, Aman 200.
    obs = obligations_for_expense({"you": 100000}, {"you": 50000, "rahul": 30000, "aman": 20000})
    assert set(obs) == {Obligation("rahul", "you", 30000), Obligation("aman", "you", 20000)}
    # The payer's own share is never owed to themselves.
    assert all(o.debtor != o.creditor for o in obs)


def test_payer_who_consumed_nothing():
    obs = obligations_for_expense({"p": 90000}, {"a": 45000, "b": 45000})
    assert set(obs) == {Obligation("a", "p", 45000), Obligation("b", "p", 45000)}
    assert net_balances(obs) == {"p": 90000, "a": -45000, "b": -45000}


def test_multiple_payers_contribution_vs_consumption():
    # a paid 600, b paid 400; a ate 200, b ate 300, c ate 500.
    obs = obligations_for_expense({"a": 60000, "b": 40000}, {"a": 20000, "b": 30000, "c": 50000})
    nets = net_balances(obs)
    assert nets == {"a": 40000, "b": 10000, "c": -50000}
    assert set(obs) == {Obligation("c", "a", 40000), Obligation("c", "b", 10000)}


def test_payments_must_match_total():
    with pytest.raises(LedgerError):
        obligations_for_expense({"a": 100}, {"a": 50, "b": 49})


@given(
    paid=st.lists(st.integers(0, 10**6), min_size=1, max_size=6),
    consumed=st.lists(st.integers(0, 10**6), min_size=1, max_size=6),
)
def test_obligations_conserve(paid, consumed):
    # Scale consumption so both sides have the same total.
    total = sum(paid)
    if sum(consumed) == 0:
        consumed = [1] + consumed[1:]
    from app.money import allocate

    cons = allocate(total, [(f"c{i}", w) for i, w in enumerate(consumed)])
    pay = {f"p{i}": v for i, v in enumerate(paid)}
    obs = obligations_for_expense(pay, cons)
    nets = net_balances(obs)
    assert sum(nets.values()) == 0
    for m in set(pay) | set(cons):
        assert nets.get(m, 0) == pay.get(m, 0) - cons.get(m, 0)
    assert all(o.amount > 0 for o in obs)


def test_pairwise_and_partial_repayment():
    entries = [
        Obligation("rahul", "you", 30000),
        Obligation("you", "rahul", 5000),  # another expense where Rahul paid
        Obligation("rahul", "you", 10000),
    ]
    assert pairwise_balances(entries) == {("rahul", "you"): 35000}
    # A confirmed repayment of 15000 from Rahul to you is an entry you -> rahul.
    entries.append(Obligation("you", "rahul", 15000))
    assert pairwise_balances(entries) == {("rahul", "you"): 20000}


def test_settlement_suggestions_clear_all():
    nets = {"a": 50000, "b": -20000, "c": -30000, "d": 0}
    plan = settlement_suggestions(nets)
    assert plan == [Obligation("c", "a", 30000), Obligation("b", "a", 20000)]
    after = dict(nets)
    for o in plan:
        after[o.debtor] += o.amount
        after[o.creditor] -= o.amount
    assert all(v == 0 for v in after.values())


@given(st.lists(st.integers(-10**6, 10**6), min_size=2, max_size=10))
def test_settlement_suggestions_property(values):
    values = values[:-1] + [-sum(values[:-1])]
    nets = {f"m{i}": v for i, v in enumerate(values)}
    plan = settlement_suggestions(nets)
    after = dict(nets)
    for o in plan:
        assert o.amount > 0
        after[o.debtor] += o.amount
        after[o.creditor] -= o.amount
    assert all(v == 0 for v in after.values())
    assert len(plan) <= max(len([v for v in values if v]) - 1, 0)
