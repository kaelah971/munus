# Munus public beta deployment

## Architecture

Munus ships as one long-running Node web service. `npm run build` creates the Vite bundle in `dist/`; `npm run server:start` serves that bundle, provides the Node API, and falls back to `dist/index.html` for client routes. The browser therefore calls an empty API base (`/auth/*`, `/profile`, `/pockets`, `/support-*`, and so on) on the same origin as the frontend. This preserves HttpOnly cookies without cross-origin configuration.

`render.yaml` describes the intended Render web service. It uses the platform `PORT`, listens on `0.0.0.0`, and keeps the Supabase service-role key server-only. The service name is `munus-public-beta`; Render supplies the final public hostname after the service is created.

## Build and runtime

```bash
npm ci
npm run build
npm run server:start
```

The server fails at startup when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing. Hosting-provided `PORT` is accepted; `MUNUS_SERVER_PORT` takes precedence for local/manual runs.

## Environment variables

### Client-safe build-time values

- `VITE_MUNUS_API_BASE_URL=` — leave empty for the one-origin deployment.
- `VITE_MUNUS_LOCAL_AUTH=false` — never enable for the public beta.
- `VITE_MUNUS_PRODUCTION_AUTH=true` — use the remote wallet-auth API.
- `VITE_MUNUS_SESSION_MODE=remote`.

These values are embedded in the browser bundle. They must not contain secrets.

### Server-only runtime values

- `NODE_ENV=production`
- `SUPABASE_URL=<the intended Supabase project URL>`
- `SUPABASE_SERVICE_ROLE_KEY=<the intended Supabase service-role key>`
- `MUNUS_NIMIQ_NETWORK=mainnet` (use `testnet` only for an intentionally separate test deployment)
- `MUNUS_COOKIE_NAME=munus_session`
- `MUNUS_COOKIE_SECURE=true`
- `MUNUS_CHALLENGE_TTL_SECONDS=300`
- `MUNUS_SESSION_TTL_SECONDS=2592000`
- `PORT` — supplied by the host; do not commit a value.
- `MUNUS_SERVER_PORT` — optional local override; it takes precedence over `PORT`.
- `MUNUS_CORS_ORIGIN` — unset for same-origin hosting. If origins are split later, set one exact frontend origin; never use `*` with credentials.

Never use a `VITE_` prefix for server secrets.

## Supabase migrations

The repository migration order is:

1. `0001_munus_account_foundation.sql`
2. `0002_production_auth_hardening.sql`
3. `0003_planning_layer.sql`
4. `0004_support_layer.sql`

Against the intended project, use the linked project workflow. This applies pending migrations and does not reset the database:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list
```

Review the dry run and project ref before the real push. Do not run `supabase db reset`, and do not run `--include-all` unless the remote migration history has been deliberately reconciled. The server uses the service-role client only on the backend; every private query filters ownership by the validated Munus session user ID. Public request endpoints return only their masked, safe projection.

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

A repository checkout cannot create the hosting project, authorize a Render account, choose a billing plan, supply Supabase credentials, or know the correct project ref. The builder must connect this repository to Render, apply the Blueprint, provide the two `sync: false` Supabase values, run the migration process above, and then record the assigned HTTPS origin for later Nimiq Mini App registration.
