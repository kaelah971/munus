# Munus

Munus is a NIM-first everyday essentials Mini App for Nimiq Pay. The Slice 1 foundation runs in a normal browser for development and detects the injected Nimiq Pay provider when hosted by Nimiq Pay.

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

## Slice 1 scope

This release includes first-use onboarding, the Home shell, the Pay Essentials entry screen, truthful empty states, and a small `src/integration/nimiq.ts` boundary. It only initializes Nimiq Pay and lists accounts when the host makes them available. It does not send transactions, call fulfilment providers, or show fabricated wallet data.

The next Fast-Build slice is the smallest NIM quote/payment proof flow for one supported essential.
