-- Munus data order snapshots. A data order pins the provider bundle it was
-- created from so later catalog changes can never silently mutate what the
-- user agreed to. requested_amount carries the snapshotted catalog price;
-- these columns preserve the plan identity and display evidence for order
-- detail and receipts.

alter table public.payment_orders
  add column if not exists provider_plan_id text;

alter table public.payment_orders
  add column if not exists plan_display_label text;

alter table public.payment_orders
  add column if not exists plan_data_allowance text;

alter table public.payment_orders
  add column if not exists plan_validity text;

comment on column public.payment_orders.provider_plan_id is
  'Provider bundle identifier snapshotted at order creation. Null for airtime orders; required before a data order can be quoted or fulfilled.';
comment on column public.payment_orders.plan_display_label is
  'Original provider bundle label preserved verbatim at order creation for receipts.';
