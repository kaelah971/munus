# Munus

Munus is a NIM-first everyday-money Mini App for Nimiq Pay. It is non-custodial: Nimiq Pay controls keys and wallet approvals, while Munus owns the application profile, preferences, and finance-management context.

## Run locally

```bash
npm install
npm run dev
```

The production-capable API runs separately:

```bash
npm run server:dev
```

Set `VITE_MUNUS_API_BASE_URL=http://localhost:8787` and `MUNUS_CORS_ORIGIN=http://localhost:5173` when the Vite client needs to call the local API cross-origin. For deployment, serve the Vite build and API behind the same origin and keep the Supabase service-role key only in the server environment.

Focused checks:

```bash
npm run test
npm run type-check
npm run lint
npm run build
```

## Slice 3 account backend

The current slice adds:

- a same-origin-compatible Node API for wallet challenge, signature verification, session restore, logout, and profile read/write;
- Nimiq Ed25519 verification through the installed `@nimiq/core` primitives, including address derivation and exact challenge bytes;
- random opaque HttpOnly-cookie sessions with server-side expiry/revocation and SHA-256 token hashes in Supabase;
- durable users, profiles, challenges, and sessions through the Supabase migrations;
- production client cutover that restores the session from the cookie and loads/saves profiles through `RemoteProfileApi`;
- explicit startup validation for server-only configuration.

`VITE_MUNUS_LOCAL_AUTH=true` remains a development-only, unverified fallback. Production builds never silently use local auth or localStorage as session truth.

## Slice 4 planning layer

Life Pockets, in-app reminders, and Spend Guard now persist through the authenticated planning API and Supabase migration. Pockets record planned allocations only: they do not lock, move, reserve, or earn NIM. Spend Guard is a soft planning limit and does not block wallet transactions. Actual spend remains unavailable until verified payment activity exists; the UI never fabricates it.

## Slice 5 support layer

Contacts, Support Mode, soft support boundaries, structured Request Help records, reviewable support drafts, and privacy-safe public request links now persist through the authenticated API and `0004_support_layer.sql`. Contacts are manual-only and archivable. Support requests and drafts never authorize NIM movement, provider fulfilment, or payment approval; all amounts remain planning data.

Apply migrations `0001` through `0004` before deploying the production API. Payments, provider fulfilment, and verified Activity transactions remain intentionally unimplemented.

## Public beta deployment

The one-origin Render deployment serves the Vite `dist/` build and Node API from the same long-running service, preserving secure HttpOnly sessions and client-route refreshes. See [`docs/deployment.md`](docs/deployment.md) and `render.yaml` for the build/runtime commands, environment contract, safe Supabase migration process, smoke test, and Nimiq Pay testing note.
