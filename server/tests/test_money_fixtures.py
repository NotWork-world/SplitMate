"""Runs the shared, hand-calculated cases in shared/fixtures/bills.json."""

import json
from pathlib import Path

import pytest

from app.money import BillInput, compute_bill

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "bills.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", FIXTURES, ids=[c["name"] for c in FIXTURES])
def test_fixture(case):
    result = compute_bill(BillInput.from_dict(case["input"]))
    d = result.to_dict()
    for key, want in case["expect"].items():
        if key == "people":
            assert {p["member_id"]: p["total"] for p in d["people"]} == want
        elif key == "items":
            assert {i["id"]: i["total"] for i in d["items"]} == want
        elif key == "issues":
            assert sorted({i["code"] for i in d["issues"]}) == sorted(want)
        elif key == "tax_lines":
            assert len(d["tax_lines"]) == len(want)
            for got, exp in zip(d["tax_lines"], want, strict=True):
                assert {k: got[k] for k in exp} == exp
        elif key == "discount_allocations":
            got = {x["id"]: x["allocations"] for x in d["discounts"]}
            assert {k: got[k] for k in want} == want
        elif key == "charge_allocations":
            got = {x["id"]: x["allocations"] for x in d["charge_lines"]}
            assert {k: got[k] for k in want} == want
        else:
            assert d[key] == want, key
    # Conservation holds for every case, valid or not.
    assert d["allocated_total"] + d["unallocated"] == d["total"]
    assert sum(p["total"] for p in d["people"]) == d["allocated_total"]


def test_parity_fixture_is_current():
    """shared/fixtures/parity.json must match the engine (run scripts/gen_parity.py after changes)."""
    path = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "parity.json"
    for case in json.loads(path.read_text(encoding="utf-8"))["cases"]:
        assert compute_bill(BillInput.from_dict(case["input"])).to_dict() == case["output"]
