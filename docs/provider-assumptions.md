# Provider assumptions registry

Every integration below works against fixtures and is fixture-tested.
Nothing here has been confirmed against a live provider unless marked
VERIFIED FROM CURRENT PROVIDER/DOCS. Do not treat an assumption as
verified because tests pass — tests use canned responses.

Legend:
- VERIFIED FROM REPO — confirmed in this repository's code or tests.
- STILL ASSUMED — taken from unauthenticated docs, memory, or naming
  convention; must be confirmed before or during the live smoke test.
- REQUIRES LIVE OPERATOR TEST — can only be confirmed with real
  credentials and a real (small) transaction.

## ClubKonnect Airtime — VERIFIED FROM REPO

- Base URL `https://www.nellobytesystems.com` (`CLUBKONNECT_BASE_URL`).
- Purchase path `/APIAirtimeV1.asp`, query path `/APIQueryV1.asp`.
- Purchase params: `MobileNetwork`, `Amount`, `MobileNumber`,
  `RequestID` (server/clubKonnect.ts `buildPurchaseParams`).
  `CallBackURL` is deliberately NOT sent: the live airtime endpoint
  rejects purchases containing it (`CALLBACK_NOT_SUPPORTED`, no order
  id, production 2026). Reconciliation polls by stable `RequestID`.
- Query params: `RequestID` and/or `OrderID`
  (`buildQueryParams`).
- Amounts are whole naira (`toProviderAmount`); MSISDN is digits-only
  (`toProviderMsisdn`, `MobileNumber` parameter).
- Stable `RequestID` derived per order and reused on retry
  (server/airtimeFulfilment.ts); retries reconcile first and never
  issue a second purchase for a known RequestID.
- Callbacks are signals only: the server re-queries the provider and
  never trusts callback fields (server/app.ts provider-callback
  handler → `reconcileByProviderReference`).

## ClubKonnect Airtime — VERIFIED FROM CURRENT PROVIDER/DOCS (2026-10-16)

- Official docs (`clubkonnect.com/APIDocs`): purchase and query are
  HTTPS GET with `UserID`/`APIKey` (+ `MobileNetwork`, `Amount`,
  `MobileNumber`, `RequestID`, `CallBackURL` for purchase;
  `OrderID` and/or `RequestID` for query). Munus matches exactly.
- Official status table (`APIParaGetDisputeResolutionV1`): 1xx
  ORDER_RECEIVED, 2xx ORDER_COMPLETED, 3xx ORDER_PROCESSING, 4xx
  ORDER_ERROR (400 INVALID_CREDENTIALS, 401 MISSING_CREDENTIALS,
  402/403 missing fields), 5xx ORDER_CANCELLED, 6xx ORDER_ONHOLD,
  799 ORDER_PROCESSED, 899 ORDER_REFUNDED.
- Official Wallet Balance API (`APIWalletBalanceV1.asp`, read-only,
  `UserID`+`APIKey` only) returns `{date, id, phoneno, balance}`.
- Official docs list an **IP whitelisting** account feature; a
  non-whitelisted server IP is therefore a live suspect whenever
  valid-shaped credentials are rejected.
- Live provider evidence: querying a never-created `RequestID` with
  valid credentials answers `status: TRANSACTION_BEYOND_30_DAYS`
  with NO `orderid` and NO `statuscode`. A provider transaction
  always carries its order id (docs: reconcile by `orderId`), so an
  ambiguous answer WITHOUT any order reference means nothing exists
  to duplicate — `providerHasNoRecord` (server/airtimeFulfilment.ts)
  resubmits with the same stable `RequestID`; any answer WITH an
  order reference only ever reconciles.

## ClubKonnect Airtime — STILL ASSUMED

- Exact network codes sent as `MobileNetwork` (mapping lives in
  `clubKonnectNetworkCode`; confirm MTN/Glo/9mobile/Airtel codes).
- Callback parameter names and delivery semantics (confirm which
  params arrive, and whether callbacks retry).
- Minimum/maximum airtime amounts and fee behavior.

## ClubKonnect Data — VERIFIED FROM REPO

- Intended paths: `/APIDatabundleNetworkV2.asp` (networks),
  `/APIDatabundlePlansV2.asp` (plans), `/APIDatabundleV1.asp`
  (purchase). Response extraction is lenient (`networks`, `data`,
  `result` wrappers tolerated).

## ClubKonnect Data — STILL ASSUMED / REQUIRES LIVE OPERATOR TEST

- All three endpoint paths and their exact params.
- Network codes used for data purchases (may differ from airtime).
- Plan ID shape and which field identifies a purchasable bundle.
- Purchase query params and the query response shape.
- MSISDN formatting for data purchases.
- Data stays guarded (capability `configured`, never `verified`)
  until the operator confirms the above. The Data architecture is
  complete and must not be removed — only the live flag is withheld.

## Paycrest — VERIFIED FROM REPO

- Base URL `https://api.paycrest.io` (`PAYCREST_BASE_URL`,
  overridable via `PAYCREST_BASE_URL`).
- Intended v2 paths: `/v2/sender/orders` (create/lookup),
  `/v2/institutions/NGN` (banks),
  `/v2/verify-account` (POST `{ institution, accountIdentifier }`),
  `/v2/rates/polygon/usdt/{amount}/ngn` (sell-rate preview).
- Auth assumption: Bearer API-key header (server/paycrest.ts
  `fetchJson`).
- Webhook handling: HMAC-SHA256 over the RAW body, signature header
  `x-paycrest-signature`, timing-safe compare; 401 on invalid, 404 on
  unknown reference; webhook is a signal, reconcile decides.
- Outcome mapping (`initiated`/`processing`/`settled`/`refunded`/
  `expired`/`failed`) in server/cashout.ts; expired quotes return 410
  and are never payable; refresh abandons the old Paycrest order.

## Paycrest — STILL ASSUMED / REQUIRES LIVE OPERATOR TEST

- All v2 paths above against current Paycrest docs (Sender API v2).
- Exact auth format (Bearer vs `API-Key` header vs other).
- Institution list response shape and bank code vocabulary.
- Verify-account request/response shape (confirm the account-name
  field that gets pinned server-side).
- Rate response shape (confirm the sell-rate field).
- Create-order payload (confirm `refundAddress` and destination
  fields) and response (confirm total/payout/receive-address/
  valid-until fields the quote persists).
- Webhook signature semantics: header name, hex vs base64, signed
  payload (raw body vs parsed), and the full status vocabulary.
- Cash out stays `configured`, never `verified`, until KYB plus the
  above are confirmed. No on-ramp exists and none is planned.

## Nimiq chain (RPC) — VERIFIED FROM REPO

- Methods used: `getTransactionByHash`, `getBlockNumber`
  (server/nimiqChain.ts `RpcNimiqChainReader`).
- Verification requires exact receiver match, exact luna-amount match,
  memo match (`MNS:<id>` via `buildPaymentMemo`), block inclusion,
  and ≥1 confirmation (`verifyNimPayment`).
- Amounts are integer luna (`LUNA_PER_NIM = 100_000n`); quotes carry
  a bounded TTL and freshness is enforced server-side
  (`requireFreshQuote`).
- Without `NIMIQ_RPC_URL`, submissions stay ONCHAIN_PENDING and
  retryable instead of verifying — never assumed paid.

## Nimiq chain (RPC) — STILL ASSUMED / REQUIRES LIVE OPERATOR TEST

- `getTransactionByHash` response shape against the configured RPC
  endpoint (field names for to/value/data/block/confirmations; the
  parser tolerates `data`, `recipientData`, `senderData`, `extraData`
  — confirm which one actually carries the memo).
- Confirmation depth behavior on the target network.

## Nimiq Pay host — VERIFIED FROM REPO

- No wallet permission is requested on mount: `initializeNimiqPay`
  only initializes; accounts are requested explicitly during sign-in
  (`requestNimiqAccounts` from user tap).
- NIM approval happens only from the review screen's explicit pay
  tap; USDT approval only from the cash-out review's explicit tap.
- Installed `@nimiq/mini-app-sdk@0.2.4` exposes no EVM provider, so
  USDT moves through a structural EIP-1193 object only.

## Nimiq Pay host — STILL ASSUMED / REQUIRES LIVE OPERATOR TEST

- Native NIM send/approve behavior inside the real host.
- Injected EIP-1193 Polygon provider behavior (chain id reporting,
  `eth_sendTransaction` handling, rejection surfacing).
