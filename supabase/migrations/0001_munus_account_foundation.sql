-- Munus account foundation.
-- Wallet authentication is verified by the Munus API. The API uses a
-- server-only Supabase service-role client and enforces ownership from its
-- validated session user_id; these auth.uid() policies are not treated as the
-- primary boundary unless Supabase Auth JWTs are introduced later.

create extension if not exists pgcrypto;

do $$ begin
  create type public.munus_network as enum ('mainnet', 'testnet');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.munus_payment_asset as enum ('NIM');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  wallet_network public.munus_network not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  avatar_reference text,
  country text not null default 'NG',
  local_currency text not null default 'NGN',
  default_phone text,
  default_network text,
  preferred_payment_asset public.munus_payment_asset not null default 'NIM',
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  app_lock_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.sessions enable row level security;

create policy "users can read their own wallet identity"
  on public.users for select
  using (id = auth.uid());

create policy "users can update their own wallet identity"
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users can read their own profile"
  on public.profiles for select
  using (user_id = auth.uid());

create policy "users can create their own profile"
  on public.profiles for insert
  with check (user_id = auth.uid());

create policy "users can update their own profile"
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can read their own preferences"
  on public.user_preferences for select
  using (user_id = auth.uid());

create policy "users can create their own preferences"
  on public.user_preferences for insert
  with check (user_id = auth.uid());

create policy "users can update their own preferences"
  on public.user_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Challenges and sessions are backend-only. There are intentionally no
-- frontend policies for them; the auth service uses its server credentials.
