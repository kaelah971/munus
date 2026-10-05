# Munus

**Keep everyday moving.**

Munus is an everyday-money Mini App built around NIM. It adds planning, people, reminders, and recovery context around the wallet flow so everyday essentials have somewhere to go before and after a payment.

**Everyday essentials, paid with NIM.**

> **NIM for normal life.**

**Plan it. Pay it. Prove it.**

## Why Munus?

A wallet is good at showing and moving assets. Everyday money needs more context:

- What needs paying?
- When is it due?
- Who is it for?
- What happened after the payment?
- Was the real-world service actually fulfilled?

Munus is built around a simple flow:

```text
Prepare → Pay → Remember → Recover
```

The repository currently delivers the preparation and support context around that flow. Payment execution, provider fulfilment, and verified transaction history remain intentionally separate roadmap work.

## What is Munus?

Munus is the everyday-money and context layer around **Nimiq Pay**. It helps people organize upcoming needs, prepare support for someone else, and keep application context close to the wallet experience.

Munus does **not** replace Nimiq Pay. Nimiq Pay remains the non-custodial boundary for wallet keys, account access, signing, and transaction approval. Munus owns application identity and session state, profiles, planning, support context, and the orchestration around future payment and receipt flows. It never treats a planning record as an on-chain balance or a payment as complete without evidence.

## Core Product Experience

### Home

A mobile starting point for connecting an account, viewing wallet state exposed by Nimiq Pay, and reaching everyday planning and support actions.

### Pay Essentials

A focused surface for categories such as airtime, data, electricity, and cable or internet. The category UI is present, but payment and provider fulfilment are not live in the current slice. It cannot send NIM.

### Life Pockets

Create a place for an upcoming need such as data, rent, school, medical care, transport, or family support. Pockets support target amounts, deadlines, progress, and planning allocations in NIM or NGN. They do not lock, reserve, move, or earn NIM.

### Reminders

Create one-time or repeating in-app reminders linked to a Life Pocket or to a standalone need. These are application reminders; no push scheduler is implied.

### Spend Guard

Set soft planning limits and warning thresholds for everyday categories. Spend Guard helps users notice a plan; it does not block wallet transactions or invent actual spend.

### Contacts

Save and archive contacts manually for recurring support. Contacts do not import an address book and do not grant wallet authority.

### Support Mode

Prepare specific help for someone using a saved contact, a category, an amount, and product details. Support boundaries provide soft warnings for planned support. Saved support drafts remain reviewable until payment infrastructure exists.

### Request Help

Create a structured request for a specific essential rather than open-ended cash. Request Help includes reviewable request records and the foundation for privacy-safe public request links; it does not authorize a payment or provider fulfilment.

### Activity / Proof / Receipt direction

The Activity surface is intentionally quiet until verified wallet or Munus events exist. The product direction is to connect payment context, proof of fulfilment, receipts, and recovery information without simulating transactions. Receipt Vault and richer recovery flows are planned, not live.

## How Munus Works

```text
┌──────────────────────────────┐
│ Nimiq Pay                   │
│ Wallet keys · account access │
│ Signing · transaction approval│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Munus                        │
│ Identity · planning          │
│ Reminders · support context  │
│ Payment context · proof layer│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Everyday service/provider     │
│ layer                        │
│ Planned integration boundary │
└──────────────────────────────┘
```

The service/provider layer is a deliberate future boundary. Airtime, data, electricity, internet, and other real-world fulfilment are not claimed as live capabilities in this repository.

## Authentication

The wallet authentication flow is:

```text
challenge
  → Nimiq Pay signature
  → backend verification
  → signer-derived wallet identity
  → secure server session
```

More specifically, the Munus API issues a challenge, Nimiq Pay signs it, and the backend verifies the canonical Nimiq signed-message bytes using the installed `@nimiq/core` primitives. The wallet identity is derived from the verified signer public key rather than trusted from an arbitrary request body.

Authenticated requests use an opaque HttpOnly session cookie. Session state, expiry, and revocation are held server-side, while SHA-256 token hashes are persisted in PostgreSQL. The local authentication fallback is development-only and is not production session truth.

## Architecture

The current application path is:

```text
Nimiq Pay
    ↓  Mini App SDK and wallet provider boundary
React/Vite client
    ↓  same-origin or configured API requests
Munus Node API
    ↓  pg and canonical SQL migrations
Neon PostgreSQL
```

For the one-origin deployment, the Node service serves the built Vite client, handles the API, and falls back to `dist/index.html` for client routes. The browser can therefore use the same origin for API calls and secure sessions.

## Tech Stack

Versions below are the ranges declared in `package.json`:

| Layer | Tooling |
| --- | --- |
| Client | React `^19.3.0`, TypeScript `^5.0.3`, Vite `^8.3.1` |
| Nimiq | `@nimiq/mini-app-sdk ^0.2.4`, `@nimiq/core ^2.22.0` |
| Icons and type | `@phosphor-icons/react ^2.1.10`, `@fontsource/rajdhani ^5.3.0` |
| API runtime | Node.js runtime with `tsx ^4.23.15` |
| Persistence | PostgreSQL through `pg ^8.23.1`; deployed against Neon |
| Testing | Vitest `^5.0.3`, Testing Library, jsdom |
| Quality | ESLint `^10.11.0` and TypeScript compiler checks |
| Hosting | Render one-origin web service with a Neon PostgreSQL database |

The visual direction is Liquid Gold: dark graphite, warm golden light, smoked glass, and soft depth. Rajdhani supplies the product typography and Phosphor supplies the icon system.

## Current Public Beta

The current repository is a working public-beta foundation for the Munus context layer. Implemented capabilities include:

- Nimiq Pay provider integration for wallet connection and wallet state reads.
- Wallet challenge and signature verification, signer-derived identity, secure server sessions, logout, and session restore.
- Profile persistence backed by the authenticated API.
- Life Pockets with planning allocations, deadlines, and progress.
- In-app reminders and Spend Guard soft planning limits.
- Manual contacts, Support Mode, support boundaries, saved support drafts, and Request Help records.
- Privacy-safe public request link foundations.
- App lock and a responsive mobile Mini App shell.
- PostgreSQL migrations for account, authentication, planning, and support layers.
- A Render-compatible one-origin deployment path for the Vite build and Node API.

The following are deliberately not represented as live features:

- No real airtime, data, electricity, or internet provider fulfilment.
- No payment execution from the Pay Essentials screen.
- No fabricated wallet transactions, actual-spend totals, or verified Activity history.
- No completed receipt, provider-confirmation, or recovery system.

Planning amounts, support requests, and Spend Guard values are context data. They do not move funds or change wallet state.

## Product Principles

1. **NIM first** — Design for NIM to be useful in normal life, not only inside a wallet screen.
2. **Non-custodial by default** — Nimiq Pay keeps control of keys, signing, and approval.
3. **Context before transaction** — Clarify the need, person, timing, and amount before anything moves.
4. **Proof matters** — A payment is not the same thing as real-world fulfilment; the product should preserve evidence and context.
5. **Never fake financial state** — If there is no verified wallet event or provider result, Munus says so.

## Roadmap

Checked items are present in the current repository. Unchecked items are planned direction, not shipped functionality.

### Foundation delivered

- [x] Nimiq Pay Mini App integration boundary.
- [x] Canonical signed-message wallet authentication.
- [x] Signer-derived wallet identity and secure server sessions.
- [x] Profile persistence and session restore.
- [x] Life Pockets, planning allocations, reminders, and Spend Guard.
- [x] Contacts, Support Mode, support drafts, and Request Help foundation.
- [x] Privacy-safe public request link foundation.
- [x] App lock and responsive mobile product shell.
- [x] PostgreSQL migrations and Render one-origin deployment path.

### Planned direction

- [ ] Execute real NIM payments from supported essential flows.
- [ ] Real airtime and data services.
- [ ] Electricity and internet provider integrations.
- [ ] Provider fulfilment tracking and confirmation.
- [ ] Payment orchestration across context, approval, and fulfilment.
- [ ] Verified transaction activity.
- [ ] Receipt Vault.
- [ ] Recovery flows for incomplete or disputed fulfilment.
- [ ] Save-to-Pay.
- [ ] Complete Family Support workflows.
- [ ] Emergency Top-Up.
- [ ] Bundle Finder.

## Local Development

### 1. Install

```bash
git clone <repository-url>
cd munus
npm install
cp .env.example .env
```

Use a PostgreSQL connection for `DATABASE_URL`. The server requires it at startup. For Neon, use the SSL-enabled connection string shown in the environment template and keep it server-only; never expose it through a `VITE_` variable.

For the split local client/API setup, use the values already documented by `.env.example`:

```dotenv
VITE_MUNUS_API_BASE_URL=http://localhost:8787
MUNUS_CORS_ORIGIN=http://localhost:5173
MUNUS_COOKIE_SECURE=false
```

`MUNUS_COOKIE_SECURE=false` is appropriate for local HTTP. The production deployment uses secure cookies. `VITE_MUNUS_LOCAL_AUTH=true` is available only as a development fallback and must not be enabled for the public beta.

### 2. Apply migrations

With `DATABASE_URL` pointed at the intended database:

```bash
npm run db:migrate
```

The canonical migration order is:

1. `migrations/0001_munus_account_foundation.sql`
2. `migrations/0002_production_auth_hardening.sql`
3. `migrations/0003_planning_layer.sql`
4. `migrations/0004_support_layer.sql`

The migration runner applies unapplied files in lexical order and records successful migrations in PostgreSQL.

### 3. Run the client and API

Start the API in one terminal:

```bash
npm run server:dev
```

Start the Vite client in another:

```bash
npm run dev
```

The local client runs on Vite's default port, `5173`, and the API defaults to `8787`. The intended wallet-connected flow runs inside Nimiq Pay; outside that provider environment, wallet availability is reported as unavailable rather than simulated.

### Production-style run

```bash
npm run build
npm run server:start
```

`npm run build` creates the Vite bundle in `dist/`. `npm run server:start` serves that bundle and the Node API from one long-running service.

## Verification

The repository provides these checks:

| Check | Command |
| --- | --- |
| Tests | `npm run test` |
| Typecheck | `npm run type-check` |
| Lint | `npm run lint` |
| Production build | `npm run build` |

For an interactive test watch mode, use `npm run test:watch`.

## Live Preview

[Open the Munus public beta preview](https://munus-public-beta.onrender.com)

The intended wallet-connected flow is through Nimiq Pay. The preview does not turn unavailable wallet, payment, provider, or transaction state into fake data.

## Brand

```text
Munus
Keep everyday moving.
Everyday essentials, paid with NIM.
Plan it. Pay it. Prove it.
```

“Crypto already knows how to move money.

Munus is exploring what happens when it also understands why the money is moving.”
