-- Munus essential requests: structured needs (airtime/data) that another
-- user can pay directly. Extends support_requests so request identity,
-- ownership, public links, and expiry reuse the human-support foundation.
-- Rows with essential_status set are essential requests; legacy planning
-- rows keep essential_status NULL and never match essential queries.

alter table public.support_requests
  add column if not exists service_type text
    check (service_type is null or service_type in ('AIRTIME', 'DATA'));

alter table public.support_requests
  add column if not exists provider_plan_id text;

alter table public.support_requests
  add column if not exists plan_display_label text;

alter table public.support_requests
  add column if not exists plan_data_allowance text;

alter table public.support_requests
  add column if not exists plan_validity text;

alter table public.support_requests
  add column if not exists essential_status text
    check (essential_status is null or essential_status in (
      'OPEN', 'PAYMENT_IN_PROGRESS', 'PAID', 'FULFILLING',
      'COMPLETED', 'CANCELLED', 'EXPIRED', 'NEEDS_ATTENTION'
    ));

alter table public.support_requests
  add column if not exists payment_order_id uuid references public.payment_orders(id) on delete set null;

alter table public.support_requests
  add column if not exists claim_expires_at timestamptz;

alter table public.support_requests
  add column if not exists paid_at timestamptz;

alter table public.support_requests
  add column if not exists fulfilled_at timestamptz;

-- A payer order points back at the request it satisfies so payment
-- verification and fulfilment settlement can sync request state.
alter table public.payment_orders
  add column if not exists essential_request_id uuid references public.support_requests(id) on delete set null;

create index if not exists support_requests_essential_owner_lookup
  on public.support_requests (owner_user_id, essential_status, created_at desc)
  where essential_status is not null;

create index if not exists support_requests_essential_public_lookup
  on public.support_requests (public_request_id)
  where essential_status is not null;

create index if not exists support_requests_essential_order_lookup
  on public.support_requests (payment_order_id)
  where payment_order_id is not null;

create index if not exists payment_orders_essential_request_lookup
  on public.payment_orders (essential_request_id)
  where essential_request_id is not null;

comment on column public.support_requests.essential_status is
  'Social lifecycle of a payable need. NULL marks legacy planning rows, which essential queries never match.';
comment on column public.support_requests.payment_order_id is
  'The single canonical payer order satisfying this request. Set once by a transactional claim; never two.';
comment on column public.payment_orders.essential_request_id is
  'The essential request this payer order satisfies, if any. Lets settlement sync request state.';
