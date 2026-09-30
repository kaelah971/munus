# Munus

Munus is a NIM-first everyday-money Mini App for Nimiq Pay. It is non-custodial: Nimiq Pay controls keys and wallet approvals, while Munus owns the application profile, preferences, and finance-management context.

## Run locally

```bash
npm install
npm run dev
```

Focused checks:

```bash
npm run test
npm run type-check
npm run lint
npm run build
```

## Slice 2 foundation

The current slice establishes:

- wallet-authenticated Munus account boundaries using a backend challenge/signature/session contract;
- a clearly marked local development auth adapter, never presented as production verification;
- local development persistence for profile, preferences, session metadata, and app-lock records;
- a Supabase schema with users, profiles, preferences, one-time challenges, sessions, and ownership RLS;
- real Nimiq Pay account and balance retrieval through the installed Mini App SDK;
- a bank-style Home dashboard, five-destination navigation, Profile & Settings, profile onboarding/editing, and a Web Crypto PBKDF2 app lock.

The browser fallback never invents a wallet address, balance, authentication, or activity. Payments and provider fulfilment are intentionally not implemented in this slice.
