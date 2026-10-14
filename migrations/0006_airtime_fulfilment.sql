-- Munus airtime fulfilment evidence. These columns record real provider
-- references only: the stable Munus-derived RequestID, the provider OrderID,
-- provider status, amount charged, and fulfilment timestamps. They stay null
-- until the provider is actually contacted, and only for PAID orders.

alter table public.payment_orders
  add column if not exists provider_request_id text;

alter table public.payment_orders
  add column if not exists provider_status_code text;

alter table public.payment_orders
  add column if not exists provider_status text;

alter table public.payment_orders
  add column if not exists provider_amount_charged numeric(30, 8)
    check (provider_amount_charged is null or provider_amount_charged > 0);

alter table public.payment_orders
  add column if not exists provider_remark text;

alter table public.payment_orders
  add column if not exists fulfilment_started_at timestamptz;

alter table public.payment_orders
  add column if not exists fulfilled_at timestamptz;

-- One stable provider request per order: retries reuse the same RequestID,
-- so the provider can de-duplicate and Munus never double-purchases.
-- PostgreSQL treats nulls as distinct, so draft orders are unaffected.
create unique index if not exists payment_orders_provider_request_unique
  on public.payment_orders (provider_request_id);

-- Provider callbacks arrive with the provider OrderID; this keeps that
-- lookup owner-independent and fast.
create index if not exists payment_orders_provider_order_lookup
  on public.payment_orders (provider_ref);

comment on column public.payment_orders.provider_request_id is
  'Stable Munus-derived provider RequestID, one per order. Null until a PAID order enters fulfilment; never regenerated on retry.';
comment on column public.payment_orders.provider_status_code is
  'Raw provider status code from the last reconciled provider response. Never inferred.';
comment on column public.payment_orders.fulfilled_at is
  'Set only when provider reconciliation confirms ORDER_COMPLETED. Null otherwise.';
