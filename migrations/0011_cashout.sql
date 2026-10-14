-- Munus USDT cash-out evidence. Cash-out orders carry a verified bank
-- snapshot plus Paycrest offramp references. Like every provider column
-- here, a null means that step has not happened — never invent values.
-- recipient_phone becomes nullable because cash-out has no phone
-- recipient; airtime/data validation still requires it. requested_currency
-- gains USDT because a cash-out request moves stablecoins, not naira.

alter table public.payment_orders
  alter column recipient_phone drop not null;

alter table public.payment_orders
  drop constraint payment_orders_requested_currency_check;

alter table public.payment_orders
  add constraint payment_orders_requested_currency_check
  check (requested_currency in ('NGN', 'USDT'));

alter table public.payment_orders
  add column if not exists bank_code text;

alter table public.payment_orders
  add column if not exists bank_name text;

alter table public.payment_orders
  add column if not exists bank_account_number text;

alter table public.payment_orders
  add column if not exists bank_account_name text;

alter table public.payment_orders
  add column if not exists paycrest_receive_address text;

alter table public.payment_orders
  add column if not exists paycrest_status text;

alter table public.payment_orders
  add column if not exists paycrest_valid_until timestamptz;

alter table public.payment_orders
  add column if not exists payout_ngn_amount numeric(30, 8)
    check (payout_ngn_amount is null or payout_ngn_amount > 0);

alter table public.payment_orders
  add column if not exists cashout_fee_usdt numeric(30, 8)
    check (cashout_fee_usdt is null or cashout_fee_usdt >= 0);

alter table public.payment_orders
  add column if not exists usdt_total_amount numeric(30, 8)
    check (usdt_total_amount is null or usdt_total_amount > 0);

alter table public.payment_orders
  add column if not exists cashout_rate_ngn_per_usdt numeric(30, 8)
    check (cashout_rate_ngn_per_usdt is null or cashout_rate_ngn_per_usdt > 0);

-- One Munus order links at most one Paycrest offramp order.
create unique index if not exists payment_orders_paycrest_order_unique
  on public.payment_orders (provider_ref)
  where provider = 'paycrest' and provider_ref is not null;

comment on column public.payment_orders.bank_account_number is
  'Full bank account number, owner-only. Never include in public projections; UI shows a masked form.';
comment on column public.payment_orders.paycrest_status is
  'Raw Paycrest sender-order status from the last reconcile or webhook. Never inferred.';
comment on column public.payment_orders.usdt_total_amount is
  'Authoritative USDT amount the wallet must send, from the Paycrest create response. Never computed client-side.';
