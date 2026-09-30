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

`VITE_MUNUS_LOCAL_AUTH=true` remains a development-only, unverified fallback. Production builds never silently use local auth or localStorage as session truth. Payments, Pockets, contacts, Activity transactions, and provider fulfilment remain intentionally unimplemented.
