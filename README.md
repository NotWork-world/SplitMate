# SplitMate

**Eat together. Split only what you shared. Know exactly who owes whom.**

SplitMate is an Android app (React Native) with a FastAPI server for splitting expenses among friends, flatmates, couples and travel groups. Its signature feature turns a restaurant bill into swipe cards: swipe right to say who had a dish, left to come back to it later. GST (CGST + SGST / IGST, inclusive or exclusive), discounts, coupons, service charges, tips and rounding are calculated exactly in integer paise, and every share reconciles to the total.

The product spec is [prompt.md](prompt.md); architecture, money rules and milestones are in [PLAN.md](PLAN.md).

## Repository layout

```
server/            FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL
  app/money/       exact bill engine, allocation, ledger maths  ← the financial core
  app/services/    expense, repayment, auth, ledger workflows (transactions, idempotency, audit)
  app/api/         HTTP routers (OpenAPI at /api/docs)
  app/integrations Google token verification, receipt parser, private storage
  alembic/         versioned migrations
  tests/           pytest: money, ledger, API workflow, security, receipts
mobile/            React Native 0.87 (TypeScript), Android
  src/money/       TypeScript port of the engine (live previews)
  src/design/      design system: tokens, theme, components, dish visuals
  src/features/    auth, home, groups, expenses (editor, swipe-to-claim, review), balances,
                   repayments, activity, profile/settings, receipts
  fastlane/        Google Play listing text and graphics
shared/fixtures/   bill test cases run by BOTH test suites (+ 300 generated parity cases)
docs/              deploy (Render + Neon), Google sign-in, Play Store, privacy policy
render.yaml        Render blueprint for the API
```

## Run the server

Python 3.12+ (tested on 3.14).

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt        # macOS/Linux: .venv/bin/pip
copy .env.example .env                                   # optional; defaults work for local dev
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

API docs: <http://localhost:8000/api/docs>. Health: `/api/health`.

### Environment variables (`SPLITMATE_` prefix, see `server/.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `ENV` | `development` | `production` refuses default secrets and SQLite |
| `DATABASE_URL` | `sqlite:///./splitmate.db` | PostgreSQL URL in production (Neon `postgres://` URLs are accepted) |
| `JWT_SECRET`, `SIGNING_SECRET` | dev placeholders | Access tokens and receipt link signatures |
| `ACCESS_TOKEN_MINUTES` / `REFRESH_TOKEN_DAYS` | 15 / 30 | Session lifetimes (refresh tokens rotate) |
| `GOOGLE_CLIENT_IDS` | empty | Web OAuth client ID(s); empty hides Google sign-in |
| `STORAGE_BACKEND` | `local` | `local` or `s3` (Cloudflare R2 etc.) + `S3_*` settings |
| `RECEIPT_MAX_MB`, `SIGNED_URL_SECONDS` | 8, 300 | Upload limit, receipt link lifetime |
| `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE` | 120, 10 | Per-IP limits (0 = off) |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | Used in local-storage receipt links |

### Database migrations

```bash
.venv/Scripts/alembic upgrade head                                 # apply
.venv/Scripts/alembic revision --autogenerate -m "describe change"  # after changing app/models.py
.venv/Scripts/alembic check                                        # models and migrations agree
```

Production containers run `alembic upgrade head` before starting. Tables are never auto-created.

## Run the app

Node 22+, JDK 17, Android SDK (API 36), an emulator or phone.

```bash
cd mobile
npm install
npm start                 # Metro
npm run android           # build, install, launch (debug talks to http://10.0.2.2:8000)
```

On a physical phone, set the server under **Settings → Advanced → Server**, or `adb reverse tcp:8000 tcp:8000` and use `http://localhost:8000`.

Release builds and Google Play: [docs/play-store.md](docs/play-store.md). Server hosting: [docs/deploy.md](docs/deploy.md). Google sign-in: [docs/google-sign-in.md](docs/google-sign-in.md).

## Tests

```bash
cd server && .venv/Scripts/python -m pytest          # money, ledger, API, security, receipts, migrations
cd mobile && npm test && npm run typecheck           # TS engine (fixtures + Python parity), UI logic
```

Run the server suite against PostgreSQL by setting `SPLITMATE_DATABASE_URL` to a Postgres URL first; the suite applies the real Alembic migrations. After changing either money engine, regenerate the parity cases with `server/.venv/Scripts/python server/scripts/gen_parity.py` — both suites fail if the engines disagree.

## Money rules in one paragraph

All amounts are integers in the currency's minor unit (INR paise; JPY has none, KWD has three decimals). Rates are basis points, quantities thousandths. Order: line gross → item discount → pre-tax bill discounts (proportional) → GST per rate group (inclusive prices are never taxed again; CGST and SGST are each rounded, IGST once; receipt-printed tax replaces the estimate and is labelled) → charges → post-tax coupons → rounding → total. Every split uses the largest-remainder method with a fixed tie-break, so shares always add up exactly. Details: [PLAN.md §2](PLAN.md).

## Known limitations

- **Push notifications** (FCM) aren't set up; notifications appear in the app (bell on Home). Adding FCM needs a Firebase project and `google-services.json`.
- **Offline:** drafts are kept on the phone and can be edited offline, then sent when back online. Lists and balances need a connection (they show a clear offline state). There's no background sync of finalised data.
- **Receipt scanning** recognises text on the phone (ML Kit) and parses common Indian restaurant layouts; unusual layouts may need more manual correction. Every line is reviewed before use.
- **Payments:** no payment provider is integrated. UPI opens the person's own UPI app; a repayment counts only after the recipient confirms it.
- **Currencies:** each expense has one currency and balances are kept per currency; there's no currency conversion.
- **Rate limiting** is in-process (one server instance).
- Google Sign-In and R2 storage need the owner's credentials ([docs](docs/)); both are implemented and tested with mocks.
