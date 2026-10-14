-- Munus recovery evidence. Recovery Center refresh/retry actions re-query
-- the provider; last_reconciled_at records the most recent provider
-- contact so users can tell a fresh check from a stale one. No other
-- recovery metadata is persisted: quotes, chain evidence, and provider
-- references on the row remain the single source of truth.

alter table public.payment_orders
  add column if not exists last_reconciled_at timestamptz;

comment on column public.payment_orders.last_reconciled_at is
  'Most recent provider contact for this order (reconcile or purchase attempt). Null until the provider is first contacted.';
