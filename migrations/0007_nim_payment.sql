-- Munus NIM payment evidence. Quotes carry an exact integer luna amount
-- (authoritative chain amount), the live rate they were derived from, the
-- receiver, the network, and the order-bound memo. Chain verification
-- evidence (sender, block, confirmations, verified-at) lands here only from
-- independent RPC reads — never from browser claims.

alter table public.payment_orders
  add column if not exists payment_network text
    check (payment_network is null or payment_network in ('mainnet', 'testnet'));

alter table public.payment_orders
  add column if not exists quote_rate_ngn_per_nim numeric(30, 8)
    check (quote_rate_ngn_per_nim is null or quote_rate_ngn_per_nim > 0);

alter table public.payment_orders
  add column if not exists quote_luna_amount bigint
    check (quote_luna_amount is null or quote_luna_amount > 0);

alter table public.payment_orders
  add column if not exists quote_source text;

alter table public.payment_orders
  add column if not exists quote_observed_at timestamptz;

alter table public.payment_orders
  add column if not exists payment_memo text;

alter table public.payment_orders
  add column if not exists payment_receiver text;

alter table public.payment_orders
  add column if not exists payment_sender text;

alter table public.payment_orders
  add column if not exists payment_block_number bigint
    check (payment_block_number is null or payment_block_number >= 0);

alter table public.payment_orders
  add column if not exists payment_confirmations integer
    check (payment_confirmations is null or payment_confirmations >= 0);

alter table public.payment_orders
  add column if not exists payment_verified_at timestamptz;

alter table public.payment_orders
  add column if not exists payment_failure_reason text;

comment on column public.payment_orders.quote_luna_amount is
  'Authoritative integer chain amount in luna. Display NIM is derived from this; floating point is never used for payment equality.';
comment on column public.payment_orders.payment_sender is
  'Chain-derived actual sender from RPC evidence. May differ from the authenticated session wallet; never trusted from the client.';
comment on column public.payment_orders.payment_network is
  'Nimiq network of the quote and payment. Only verified mainnet payments may trigger real provider fulfilment.';
