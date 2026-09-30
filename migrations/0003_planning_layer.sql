-- Munus planning objects. These represent personal plans only; they do not
-- custody, lock, move, or reserve NIM on the blockchain.

create table if not exists public.pockets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  type text not null check (type in ('Data', 'Light bill', 'Rent', 'School', 'Medical', 'Emergency', 'Transport', 'Family support', 'Business', 'Subscription', 'Custom')),
  unit text not null check (unit in ('NIM', 'NGN')),
  target_amount numeric(30, 8) not null check (target_amount > 0),
  planned_amount numeric(30, 8) not null default 0 check (planned_amount >= 0),
  deadline timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pocket_entries (
  id uuid primary key default gen_random_uuid(),
  pocket_id uuid not null references public.pockets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(30, 8) not null check (amount > 0),
  direction text not null check (direction in ('allocation', 'reduction')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  linked_object_type text not null check (linked_object_type in ('pocket', 'standalone')),
  linked_object_id uuid,
  title text not null check (char_length(title) between 2 and 120),
  due_at timestamptz not null,
  repeat_rule text check (repeat_rule is null or repeat_rule in ('weekly', 'monthly')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (linked_object_type = 'standalone' or linked_object_id is not null)
);

create table if not exists public.spend_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null check (category in ('Data', 'Family support', 'Subscriptions', 'Transport', 'General essentials')),
  unit text not null check (unit in ('NIM', 'NGN')),
  limit_amount numeric(30, 8) not null check (limit_amount > 0),
  period text not null check (period in ('weekly', 'monthly')),
  warning_threshold numeric(5, 2) not null default 80 check (warning_threshold >= 0 and warning_threshold <= 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pockets_user_status_lookup on public.pockets (user_id, status, created_at desc);
create index if not exists pocket_entries_pocket_lookup on public.pocket_entries (pocket_id, created_at desc);
create index if not exists pocket_entries_user_lookup on public.pocket_entries (user_id, created_at desc);
create index if not exists reminders_user_due_lookup on public.reminders (user_id, status, due_at);
create index if not exists spend_rules_user_lookup on public.spend_rules (user_id, enabled);

comment on table public.pockets is
  'Personal planning targets, not a custodial wallet or on-chain balance.';
comment on table public.pocket_entries is
  'Exact decimal planning allocations/reductions, not blockchain transactions.';
comment on table public.reminders is
  'In-app planning reminders; no push scheduler is implied.';
comment on table public.spend_rules is
  'Soft planning guards that do not block wallet transactions.';
