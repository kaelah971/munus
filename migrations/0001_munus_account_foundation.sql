-- Munus account foundation for a server-owned PostgreSQL deployment.
-- Wallet authentication is verified by the API; this schema does not depend on
-- a hosted auth provider or browser-issued database JWTs.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  wallet_network text not null check (wallet_network in ('mainnet', 'testnet')),
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
  preferred_payment_asset text not null default 'NIM' check (preferred_payment_asset = 'NIM'),
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

comment on table public.sessions is
  'Opaque server session hashes only; raw session tokens never enter PostgreSQL.';
comment on table public.auth_challenges is
  'Short-lived, single-use wallet login challenges verified by the Munus API.';
