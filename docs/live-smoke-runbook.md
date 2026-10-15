# Live smoke runbook (operator-driven only)

No step here is automated and none may be automated. Every step is a
manual operator action with a checkpoint. Stop at the first unexpected
state and inspect before proceeding. Never retry a spend blindly:
reconcile first, and reuse the same RequestID rules the server
enforces.

## Preconditions (all rails)

- Production deploy is healthy: authenticated `GET /readiness`
  reports `"database": "ready"`.
- `MUNUS_NIMIQ_NETWORK=mainnet` on the server. Testnet wallets and
  testnet-quoted orders can never trigger provider spend (the server
  rejects non-mainnet fulfilment with 409) — confirm the network
  field in the readiness report before starting.
- Operator wallet: Nimiq Pay with a small amount of real mainnet NIM.
- Operator-controlled Nigerian phone number that can receive airtime
  and confirm delivery out-of-band (USSD/balance check).
- Smallest valid amounts only: ₦100 airtime for TEST A; cheapest
  bundle for Data; small USDT for cash out (later).
- No automated test may invoke these steps: tests use fixture fetches
  and never carry real credentials.

## TEST A — NIM → Airtime (run first)

Use the smallest valid airtime amount (₦100) to the
operator-controlled number.

1. DRAFT — Connect Nimiq Pay, open Pay → Airtime, enter the number,
   network, and ₦100. Save. Checkpoint: order review shows DRAFT,
   "quote not created", no wallet prompt appeared.
   - If saving fails: inspect the inline error; confirm session is
     valid (sign out/in once); confirm `/readiness` is reachable.
2. READY_FOR_PAYMENT — Tap "Get NIM quote". Checkpoint: review shows
   the exact NIM amount, rate, receiver, memo, and a live countdown.
   - If 503: NIM payments are not configured — stop. Do not proceed.
     Set `MUNUS_NIM_RECEIVER_ADDRESS` (and `NIMIQ_RPC_URL` for
     verification) and redeploy.
   - If the amount looks wrong: stop. Compare against the current
     CoinGecko NIM/NGN rate; quotes must never be edited client-side.
3. Wallet approval — Tap pay once. Checkpoint: Nimiq Pay opens (only
   from this tap), showing the exact quoted NIM to the Munus
   receiver with the `MNS:` memo.
   - If the wallet shows a different amount/receiver: reject in the
     wallet, stop, and compare the intent against the review screen.
   - If dismissed: tap again (idempotent intent, same quote).
4. ONCHAIN_PENDING — Approve. Checkpoint: review shows Submitted with
   a transaction reference; no delivery claimed.
   - If the reference never records: use "Retry recording" (same
     hash — never a second transfer).
5. PAID — Wait for server verification (auto-reconcile on open, or
   "Refresh payment status"). Checkpoint: payment Confirmed on-chain
   with sender/receiver/block.
   - If stuck ONCHAIN_PENDING: confirm `NIMIQ_RPC_URL` is set and the
     RPC endpoint answers `getTransactionByHash` for the reference;
     check the memo matches `MNS:<order-id>` exactly and the tx has
     ≥1 confirmation. Without RPC, orders stay pending by design.
6. FULFILLING — Checkpoint: fulfilment "Provider is fulfilling",
   provider reference present, `RequestID` stable for the order.
   - If it never starts: confirm `CLUBKONNECT_*` are set and
     `/readiness` shows the airtime rail at least `configured`.
7. DELIVERED — Checkpoint: provider confirms; review shows Delivered
   with provider status. Reconcile first on any doubt — the callback
   is only a signal and never trusted directly.
   - If failed/recovery: open Recovery Center from Activity, Refresh
     (reconcile), then Retry only if offered — retry reuses the same
     RequestID, never a new purchase.
8. Completed receipt — Checkpoint: Activity shows the receipt with
   masked phone, verified payment evidence, and provider delivery.
9. Munus Live — Checkpoint: `/live` increments Verified wallets
   (once per wallet), Essentials delivered, and NIM used (exact
   verified luna). Allow ~60 seconds for the cache.

After a clean TEST A: set `MUNUS_AIRTIME_LIVE=true` and redeploy.
Only then does the UI present Airtime as verified.

## TEST B — Essential Request E2E (plan, operator-driven)

Wallet/User A (requester):
1. Create the cheapest Airtime request for the operator-controlled
   number; copy the share URL.

Wallet/User B (payer, different wallet):
2. Open the share URL signed out; confirm only the safe projection
   shows (need, amount, masked phone — no wallet or internal IDs).
3. Claim, quote, and approve real NIM from the payer wallet.

Then confirm, in order:
- Order is owned by the payer; request is owned by requester A.
- The actual phone receives the airtime (out-of-band check).
- Order reaches DELIVERED; request reaches COMPLETED.
- Payer receipt works; public request page shows Completed.
- Munus Live reflects the activity (wallets, delivery, volume,
  completed request) within ~60 seconds.

Failure inspection mirrors TEST A steps 5–7, plus: if the request
does not advance, check the bidirectional link
(`paymentOrderId` ↔ `essentialRequestId`) via the reconcile/refresh
paths — never by editing state.

## Data live test (only after assumption check)

Do not run a Data smoke until docs/provider-assumptions.md "ClubKonnect
Data" items are confirmed against current authenticated docs. Then use
the cheapest bundle on the operator number and follow TEST A steps
1–9, with these extra checkpoints: catalog networks/plans render from
the live catalog (never typed); the purchased bundle matches the
quoted plan ID; usage/data balance confirms out-of-band. After a
clean run: set `MUNUS_DATA_LIVE=true`. Until then Data stays
guarded (`configured`) — architecture complete, flag withheld.

## Cash-out live gating

Cash out stays `configured`, never `verified`, until Paycrest KYB is
approved, server credentials plus the verified USDT contract and
refund address are set, and docs/provider-assumptions.md "Paycrest"
items are confirmed. The UI explains availability before money can
move; expired payout details (410) are never payable. No on-ramp
exists. Set `MUNUS_CASHOUT_LIVE=true` only after a real small
settlement reconciles to DELIVERED with no duplicate purchase.
