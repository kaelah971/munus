-- Munus payment order foundation. Orders are durable application records
-- that separate crypto payment state from real-world fulfilment state.
-- A row here is never evidence of payment, provider fulfilment, a rate,
-- or a receipt. Quotes, wallet transactions, and provider references arrive
-- in later slices; until then those columns stay null.

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  service_type text not null check (service_type in ('AIRTIME', 'DATA', 'CASH_OUT')),
  payment_asset text not null check (payment_asset in ('NIM', 'USDT')),
  recipient_phone text not null check (char_length(recipient_phone) between 10 and 16),
  recipient_network text check (recipient_network is null or recipient_network in ('MTN', 'Airtel', 'Glo', '9mobile')),
  recipient_country text not null default 'NG' check (recipient_country = 'NG'),
  requested_amount numeric(30, 8) not null check (requested_amount > 0),
  requested_currency text not null default 'NGN' check (requested_currency = 'NGN'),
  quoted_crypto_amount numeric(30, 8) check (quoted_crypto_amount is null or quoted_crypto_amount > 0),
  quote_expires_at timestamptz,
  wallet_tx_ref text,
  provider_ref text,
  provider text,
  payment_status text not null default 'DRAFT' check (payment_status in ('DRAFT', 'QUOTE_PENDING', 'READY_FOR_PAYMENT', 'AWAITING_WALLET_APPROVAL', 'ONCHAIN_PENDING', 'PAID', 'PAYMENT_FAILED')),
  fulfilment_status text not null default 'NOT_STARTED' check (fulfilment_status in ('NOT_STARTED', 'FULFILLING', 'DELIVERED', 'FULFILLMENT_FAILED', 'RECOVERY_REQUIRED', 'REFUNDED', 'RESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_user_lookup on public.payment_orders (user_id, created_at desc);
create index if not exists payment_orders_user_status_lookup on public.payment_orders (user_id, payment_status, fulfilment_status);

comment on table public.payment_orders is 'Durable payment orders. payment_status tracks crypto payment only; fulfilment_status tracks real-world delivery only. Null quote/tx/provider columns mean that step has not happened.';
comment on column public.payment_orders.wallet_tx_ref is 'Real wallet transaction reference only; never fabricated. Null until a wallet approval confirms.';
comment on column public.payment_orders.provider_ref is 'Real provider reference only; never fabricated. Null until a provider responds.';
