-- Explicit challenge state and lookup indexes for the Munus wallet session boundary.

alter table public.auth_challenges
  add column if not exists wallet_network text not null default 'mainnet';

alter table public.auth_challenges
  add column if not exists nonce text not null default '';

alter table public.auth_challenges
  drop constraint if exists auth_challenges_wallet_network_check;

alter table public.auth_challenges
  add constraint auth_challenges_wallet_network_check
  check (wallet_network in ('mainnet', 'testnet'));

create index if not exists auth_challenges_active_lookup
  on public.auth_challenges (id, expires_at)
  where consumed_at is null;

create index if not exists sessions_active_user_lookup
  on public.sessions (user_id, expires_at)
  where revoked_at is null;

comment on table public.sessions is
  'Opaque server session hashes only. Ownership comes from the validated Munus session user_id.';
comment on table public.auth_challenges is
  'Server-created, short-lived, single-use wallet login challenges.';
