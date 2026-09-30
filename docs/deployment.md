# Munus public beta deployment

## Architecture

Munus ships as one long-running Node web service. `npm run build` creates the Vite bundle in `dist/`; `npm run server:start` serves that bundle, provides the Node API, and falls back to `dist/index.html` for client routes. The browser therefore calls an empty API base (`/auth/*`, `/profile`, `/pockets`, `/support-*`, and so on) on the same origin. This preserves HttpOnly cookies without cross-origin configuration.

`render.yaml` describes the intended Render web service. It uses the platform `PORT`, listens on `0.0.0.0`, and keeps `DATABASE_URL` server-only. The service name is `munus-public-beta`; Render supplies the final public hostname after the service is created.

## Build and runtime

```bash
npm ci
npm run build
npm run db:migrate
npm run server:start
```

The server fails at startup when `DATABASE_URL` is missing. Hosting-provided `PORT` is accepted; `MUNUS_SERVER_PORT` takes precedence for local/manual runs. Neon connection strings should include `sslmode=require`.

## Environment variables

### Client-safe build-time values

- `VITE_MUNUS_API_BASE_URL=` — leave empty for the one-origin deployment.
- `VITE_MUNUS_LOCAL_AUTH=false` — never enable for the public beta.
- `VITE_MUNUS_PRODUCTION_AUTH=true` — use the remote wallet-auth API.
- `VITE_MUNUS_SESSION_MODE=remote`.

These values are embedded in the browser bundle. They must not contain secrets.

### Server-only runtime values

- `NODE_ENV=production`
- `DATABASE_URL=<the Neon PostgreSQL connection string with SSL enabled>`
- `MUNUS_NIMIQ_NETWORK=mainnet` (use `testnet` only for an intentionally separate test deployment)
- `MUNUS_COOKIE_NAME=munus_session`
- `MUNUS_COOKIE_SECURE=true`
- `MUNUS_CHALLENGE_TTL_SECONDS=300`
- `MUNUS_SESSION_TTL_SECONDS=2592000`
- `PORT` — supplied by the host; do not commit a value.
- `MUNUS_SERVER_PORT` — optional local override; it takes precedence over `PORT`.
- `MUNUS_CORS_ORIGIN` — unset for same-origin hosting. If origins are split later, set one exact frontend origin; never use `*` with credentials.

Never use a `VITE_` prefix for `DATABASE_URL`.

## Neon migrations

The canonical migration order is:

1. `migrations/0001_munus_account_foundation.sql`
2. `migrations/0002_production_auth_hardening.sql`
3. `migrations/0003_planning_layer.sql`
4. `migrations/0004_support_layer.sql`

The repository includes a deterministic migration runner. Against the intended Neon project, set `DATABASE_URL` in the server environment and run:

```bash
npm ci
npm run db:migrate
```

The runner creates `public.schema_migrations`, takes a PostgreSQL advisory lock, applies unapplied files in lexical order inside individual transactions, and records each successful file. It never resets or drops the database. Review the target connection string before running it; do not point this command at a production database until the schema has been intentionally approved.

## Smoke test after deploy

1. Open the service URL on desktop and a small mobile viewport.
2. Refresh `/`, `/support`, `/pockets`, and a copied `/request/<opaque-id>` URL; each must load the app rather than a hosting 404.
3. Outside Nimiq Pay, confirm the wallet connection state is truthfully unavailable. Inside Nimiq Pay, confirm the injected account and balance appear.
4. Sign in and refresh. Confirm the server session restores without a localStorage auth token.
5. Save a profile, pocket allocation, reminder, contact, support draft, and Request Help record; refresh and confirm each persists.
6. Open a public request link in a signed-out browser. Confirm it shows only the requester label, need, amount, optional masked phone/network, and message—never a wallet address or internal ID.
7. Confirm logout revokes the session and private API routes return `401` afterward.

Pay, Activity, provider fulfilment, receipts, refunds, automatic payments, and USDT remain intentionally unavailable. Munus must be tested inside Nimiq Pay for wallet behavior; a normal browser must not be treated as a wallet host.

## Manual release boundary

A repository checkout cannot create the hosting project, authorize a Render account, choose a billing plan, supply the Neon connection string, or know the correct Neon project. The builder must connect this repository to Render, apply the Blueprint, provide `DATABASE_URL`, run `npm run db:migrate` once against the intended Neon project, and then record the assigned HTTPS origin for later Nimiq Mini App registration.
