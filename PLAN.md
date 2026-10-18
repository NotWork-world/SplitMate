# SplitMate — Build Plan

> "Eat together. Split only what you shared. Know exactly who owes whom."

`prompt.md` is the product specification. This file is the architecture, the
milestones and the working checklist. It is updated as phases land.

## 0. Starting point (audit, 2026-10-18)

- The repository contained only `prompt.md`: no code, schema, tests or config.
- The NotWork-world organisation's other app, **KonPDF**, sets the house style:
  bare **React Native + TypeScript** (Redux Toolkit, React Navigation, Jest)
  for Android, a **Python FastAPI** service on **Render** (Dockerfile +
  `render.yaml`, pytest), Google Play readiness (target API 36, 16 KB pages,
  R8, signed `bundleRelease`, version code from `package.json`, fastlane
  metadata, privacy policy, Data-safety answers).
- Decisions confirmed with the owner:
  - Mobile: **React Native 0.87 (bare, TypeScript)**, matching KonPDF.
  - Backend: **FastAPI on Render**, **PostgreSQL on Neon** (free tier does not expire).
  - Sign-in: **email + password** and **Google Sign-In**.
  - Code lives in the private repo `NotWork-world/SplitMate`.
- Local tools: Node 24, Python 3.14, JDK 17, Android SDK (API 36, NDK 28),
  an API 36 emulator, Docker. No `gh` CLI.

## 1. Architecture

```
SplitMate/
├── server/                 FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2
│   ├── app/
│   │   ├── money/          ★ exact financial engine (integer minor units)
│   │   ├── ledger/         obligations, balances, settlement suggestions
│   │   ├── models/         SQLAlchemy ORM (normalised schema)
│   │   ├── schemas/        Pydantic request/response models
│   │   ├── api/            routers: auth, users, groups, expenses, repayments, receipts, activity
│   │   ├── services/       business workflows (transactions, idempotency, audit)
│   │   ├── integrations/   OCR, storage, Google token verification (replaceable)
│   │   └── core/           config, security, errors, rate limiting
│   ├── alembic/            versioned migrations (no create_all in production)
│   └── tests/              pytest: money, ledger, API, security, migrations
├── mobile/                 React Native app (Android first)
│   └── src/
│       ├── money/          TS port of the engine for live previews (same fixtures)
│       ├── design/         tokens, typography, theme, components
│       ├── api/            typed client, RTK Query, error mapping
│       ├── features/       auth, groups, expenses, allocation, balances, repayments, receipts, activity, settings
│       └── navigation/
├── shared/fixtures/        finance test vectors run by BOTH pytest and Jest
├── docs/                   Render/Neon deploy, Google sign-in setup, Play Store, privacy policy
└── render.yaml
```

### Server is the source of truth
The phone computes previews with the TypeScript engine so the bill updates as
you type, but **every finalisation is recomputed on the server** from the
submitted items, discounts, taxes and charges. Client totals are only compared,
never trusted. `shared/fixtures/*.json` holds calculation cases (inputs and
exact expected outputs) that both test suites must pass, so the two engines
cannot drift.

## 2. Financial engine rules (documented contract)

All money is an **integer count of minor units** (paise for INR). Currency
exponents come from a table (INR 2, USD 2, JPY 0, KWD 3 …); nothing assumes
two decimals except display of 2-decimal currencies. Rates are integer
**basis points** (5% = 500). Quantities are integer **thousandths** (1.5 = 1500).
No floats anywhere in calculation code (Python `int`/`Decimal`, TS `bigint`-free
safe integers with guarded ranges).

Order of operations for an itemised bill:

1. **Line gross** = quantity × unit price (round half up once per line).
2. **Item discount** (fixed or %) → line net. A discount larger than the line is a validation error, never a negative line.
3. **Pre-tax bill discounts** (fixed, %, coupon) in the order entered, each computed on the running eligible amount and allocated to eligible items **proportionally** (default) or **equally per consumer** (explicit choice).
4. **Tax**, per rate group and per treatment:
   - *exclusive*: tax = base × rate, rounded once per rate group;
   - *inclusive*: base = amount ÷ (1 + rate), tax = amount − base (never added again);
   - *CGST + SGST*: two halves at rate/2, each rounded, total = sum (no double count);
   - *IGST*: one component at the full rate;
   - *receipt-reported* tax amounts replace computed ones and are flagged `source=receipt`; the computed estimate is kept alongside for review.
   Group tax is allocated back to items in proportion to their taxable base.
5. **Charges** (service, packaging, delivery, tip, custom): fixed or % of the
   post-discount pre-tax subtotal, optional own tax rate, allocated
   proportionally (default) or equally.
6. **Post-tax discounts** (e.g. a coupon on the final amount), proportional.
7. **Rounding adjustment**: explicit amount from the receipt, or a configured
   rule (none / nearest whole unit), allocated proportionally.
8. **Final payable** = sum of all of the above. If a receipt total is entered and differs, finalisation is **blocked** until the user fixes items or adds an explicit, labelled adjustment.

Splitting an item between consumers: equal, integer shares, percentages (basis
points, must total exactly 100.00%), or exact amounts (must total the line net).
Every component of every item is divided by the same weights.

**Leftover-unit rule (largest remainder):** each split gives everyone the floor
of their exact share; the remaining units go one at a time to the largest
fractional remainders, ties broken by the participant's stable sort key
(member id). Every split therefore conserves the total exactly.

Non-itemised expenses (rent, fuel …) are a single item with the chosen split,
so one engine handles everything.

## 3. Ledger model

- `expense_payers`: who paid the merchant and how much (sum = final total).
- `expense_allocations`: what each member consumed (sum = final total).
- `ledger_entries`: **append-only directed obligations** `debtor → creditor`,
  amount > 0, currency, source (`expense` version / `repayment`).
  - Single payer: each consumer owes the payer their share; the payer's own share creates no entry.
  - Multiple payers: each member's net (`paid − consumed`) is computed; debtors' deficits are allocated to creditors proportionally (largest remainder).
  - Editing an expense writes **reversal entries** for the old version and new entries for the new version in one transaction; history is never rewritten.
  - A repayment creates exactly one entry, only on **CONFIRMED** (unique constraint on `repayment_id`).
- Balance(A,B) = Σ(A→B) − Σ(B→A), per currency. Group nets sum to zero by construction (tested).
- Settlement suggestions: greedy largest-debtor ↔ largest-creditor matching with deterministic tie-breaks; read-only, never alters allocations.

## 4. Repayment state machine

| From | Action (who) | To |
|---|---|---|
| — | request (creditor) | REQUESTED |
| — | record payment (debtor) | MARKED_SENT |
| REQUESTED | mark sent (debtor) | MARKED_SENT |
| REQUESTED | decline (debtor) | REJECTED |
| REQUESTED | cancel (creditor) | CANCELLED |
| MARKED_SENT / AWAITING_CONFIRMATION | confirm (creditor) | CONFIRMED → ledger entry |
| MARKED_SENT / AWAITING_CONFIRMATION | dispute (creditor) | DISPUTED |
| MARKED_SENT / AWAITING_CONFIRMATION | reject — not received (creditor) | REJECTED |
| MARKED_SENT | cancel (debtor) | CANCELLED |
| DISPUTED | resubmit with note/reference (debtor) | AWAITING_CONFIRMATION |
| DISPUTED | cancel (debtor) | CANCELLED |

CONFIRMED, REJECTED and CANCELLED are terminal. Transitions use row locks and
idempotency keys; a repeated confirm returns the same result without a second
ledger entry. No payment provider is integrated, so nothing is ever
auto-confirmed; UPI is offered only as a deep link to the user's own UPI app
(`upi://pay?...`) and the result is still confirmed manually by the recipient.

## 5. Data model (tables)

users, auth_identities (password / google), refresh_tokens, groups
(type: personal / trip / home / couple / other, currency, trip dates),
group_members (user optional → placeholder friends who aren't on the app yet),
group_invites, expenses (status draft / finalized / cancelled, version,
category, date, currency, receipt total), expense_items, item_consumers,
expense_discounts, expense_charges, expense_tax_lines (component, rate, base,
amount, source), expense_payers, expense_allocations (+ per-component breakdown
JSON for audit), ledger_entries, repayments, repayment_events,
receipt_attachments, ocr_results, activity_events, notifications,
audit_events, idempotency_keys, user_preferences.

Constraints: FKs everywhere, `CHECK (amount > 0)` on ledger, unique
`(group_id, user_id)` membership, unique `repayment_id` in ledger, unique
`(user_id, key)` idempotency, indexes on every list filter.

## 6. Security

Argon2id password hashing; 15-minute JWT access tokens + rotating opaque
refresh tokens stored hashed, with reuse detection; Google ID-token verification
against configured client IDs; every query scoped through a membership check
(no IDOR); rate limits on auth and writes; generic error messages; no amounts or
emails in logs; receipts in private storage with short-lived HMAC-signed URLs;
secrets only via env (`.env.example` holds placeholders); account export (JSON)
and deletion (anonymises the user, keeps other members' ledgers consistent).

## 7. Design system

Midnight navy `#0B0F1F` → indigo `#141A33` surfaces, violet → electric-indigo
gradients (`#7C5CFF` → `#4F46E5`), lavender `#C4B5FD` accents, coral `#FF7A59`
for food and primary money actions, mint/rose for owed/owing. "Glass" =
translucent layered cards with hairline borders and soft shadows; real blur only
where it is cheap. Manrope (headings, wordmark) + Inter (body), tabular figures
for every amount. 8-pt spacing, 48-dp touch targets, WCAG AA contrast, reduced
motion respected, light theme from the same tokens. Dish visuals: a keyword →
emoji/category map (🍛 biryani, 🍕 pizza, ☕ chai …) on a gradient tile —
always accurate, offline, licence-free; unknown dishes get a neutral 🍽️ tile,
never an unrelated photo.

## 8. Milestones & checklist

Status as of 2026-10-18. "Verified" means an automated test or a run on the Android 36 emulator against the real API and PostgreSQL.

### Phase 1 — Foundation ✅
- [x] Audit repo + org conventions, confirm decisions
- [x] PLAN.md, README, .gitignore, .env.example
- [x] Money engine (Python) + 31 hand-calculated shared fixtures + property tests

### Phase 2 — Backend core ✅ (69 pytest tests, SQLite and PostgreSQL 17)
- [x] Schema + Alembic migration (`alembic check` clean on Postgres)
- [x] Auth: register/login/refresh rotation with reuse detection/logout/Google (mocked verifier)
- [x] Groups, placeholder members, invites, permissions, cross-group isolation
- [x] Expenses: drafts, finalize (transactional, idempotent, concurrent-safe), edit with ledger reversal, cancel
- [x] Ledger, balances, settlement suggestions, per-member ledger lines
- [x] Repayment state machine (confirm once, disputes/rejections never settle)
- [x] Activity, notifications with preferences, audit events, export, account deletion
- [x] Docker image runs migrations and serves (verified)

### Phase 3 — Mobile foundation ✅
- [x] RN 0.87 Android project: API 36, R8, upload-key signing, versionCode from package.json
- [x] Design system, fonts, icons, navigation, secure token storage, session restore
- [x] TS money engine: identical to Python on 300 generated bills + all fixtures (Jest)
- [x] Splash, onboarding, sign up/in (verified on emulator)

### Phase 4 — Mobile workflows ✅
- [x] Home, groups, group detail, members, invites, join by code
- [x] Expense editor: itemised and simple (equal/exact/%/shares), discounts, GST, charges, rounding, receipt total, multiple payers
- [x] Swipe-to-claim with Claim/Skip/Undo buttons and a list view; no silent assignment (verified on device + RNTL tests)
- [x] Bill review and finalise (₹630.00 example verified on device)
- [x] Expense detail with audit history, edit, cancel/delete
- [x] Balances, settle-up, repayment request → marked sent → confirmed (verified on device)
- [x] Activity, notifications, profile, settings, export, delete account, privacy

### Phase 5 — Receipts & OCR ✅ (server parser + upload tested; on-device ML Kit not yet exercised with a real photo)
- [x] Photo picker/camera, upload with validation, private storage, signed URLs
- [x] ML Kit on-device text → server parser → review with confidence and total checks
- [x] Manual entry works without any of it

### Phase 6 — Play Store & polish (in progress)
- [x] Launcher icons, store icon, feature graphic, listing text, privacy policy, Data-safety answers
- [x] Render + Neon deploy docs, render.yaml
- [x] Keyboard-safe footers and sheets on edge-to-edge Android (found on device)
- [ ] Release build verified (R8 + 16 KB alignment)
- [ ] Screenshots for the listing
- [ ] Push notifications (FCM) — needs a Firebase project
## 9. Risks

| Risk | Mitigation |
|---|---|
| Engines drift between server and phone | Shared JSON fixtures in both suites |
| Rounding disputes | One documented rule, per-component breakdown stored and shown |
| Duplicate finalisation on retries | Idempotency keys + version check + row lock |
| Render free tier sleeps | Health ping + "waking up" state, like KonPDF |
| Render disk is ephemeral | Receipts go to S3-compatible storage (Cloudflare R2) in production; local disk only in dev |
| Google Sign-In needs owner's OAuth client | Implemented and tested with a mocked verifier; hidden until configured |
| No push credentials | In-app notifications work; FCM documented as optional |
| Repo push needs owner credentials | Commit locally; push when access is configured |
