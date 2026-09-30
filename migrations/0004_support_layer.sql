-- Munus human-support planning layer. These rows prepare reviewable support
-- drafts only; they do not authorize or execute wallet/provider actions.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  relationship text,
  phone text not null check (char_length(phone) between 10 and 16),
  network text check (network is null or network in ('MTN', 'Airtel', 'Glo', '9mobile')),
  country text not null default 'NG' check (country = 'NG'),
  usual_product_type text check (usual_product_type is null or usual_product_type in ('Airtime', 'Data', 'Electricity', 'School', 'Medical', 'Transport', 'Other essential')),
  usual_amount numeric(30, 8) check (usual_amount is null or usual_amount > 0),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  category text not null check (category in ('Airtime', 'Data', 'Electricity', 'School', 'Medical', 'Transport', 'Other essential')),
  period text not null check (period in ('weekly', 'monthly')),
  soft_limit_amount numeric(30, 8) not null check (soft_limit_amount > 0),
  unit text not null check (unit in ('NIM', 'NGN')),
  warning_threshold numeric(5, 2) not null default 80 check (warning_threshold >= 0 and warning_threshold <= 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references public.users(id) on delete set null,
  recipient_user_id uuid references public.users(id) on delete set null,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  public_request_id text not null unique,
  category text not null check (category in ('Airtime', 'Data', 'Electricity', 'School', 'Medical', 'Transport', 'Other essential')),
  requested_amount numeric(30, 8) not null check (requested_amount > 0),
  requested_product text not null check (char_length(requested_product) between 2 and 160),
  phone text check (phone is null or char_length(phone) between 10 and 16),
  network text check (network is null or network in ('MTN', 'Airtel', 'Glo', '9mobile')),
  country text not null default 'NG' check (country = 'NG'),
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'expired', 'prepared')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('manual', 'contact', 'request')),
  contact_id uuid references public.contacts(id) on delete set null,
  request_id uuid references public.support_requests(id) on delete set null,
  category text not null check (category in ('Airtime', 'Data', 'Electricity', 'School', 'Medical', 'Transport', 'Other essential')),
  recipient_name text not null check (char_length(recipient_name) between 2 and 80),
  recipient_phone text not null check (char_length(recipient_phone) between 10 and 16),
  recipient_network text check (recipient_network is null or recipient_network in ('MTN', 'Airtel', 'Glo', '9mobile')),
  recipient_country text not null default 'NG' check (recipient_country = 'NG'),
  amount numeric(30, 8) not null check (amount > 0),
  unit text not null check (unit in ('NIM', 'NGN')),
  product_details text not null check (char_length(product_details) between 2 and 160),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_user_active_lookup on public.contacts (user_id, archived_at, display_name);
create unique index if not exists contacts_user_active_phone_unique on public.contacts (user_id, phone) where archived_at is null;
create index if not exists support_rules_user_lookup on public.support_rules (user_id, enabled);
create index if not exists support_requests_owner_status_lookup on public.support_requests (owner_user_id, status, created_at desc);
create index if not exists support_requests_recipient_status_lookup on public.support_requests (recipient_user_id, status, created_at desc);
create index if not exists support_drafts_user_lookup on public.support_drafts (user_id, status, created_at desc);

comment on table public.contacts is 'Manual support contacts; no address-book import or wallet authority.';
comment on table public.support_rules is 'Soft support planning limits, not transaction blocks.';
comment on table public.support_requests is 'Specific essential requests with reviewable lifecycle states.';
comment on table public.support_drafts is 'Reviewable support intents; never a payment authorization.';
