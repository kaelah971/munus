-- Production auth hardening for the server-owned wallet session boundary.
-- The API uses a server/service-role client and enforces ownership from its
-- validated session record; these columns make challenge state explicit.

alter table public.auth_challenges
  add column if not exists wallet_network public.munus_network not null default 'mainnet';

alter table public.auth_challenges
  add column if not exists nonce text not null default '';

create index if not exists auth_challenges_active_lookup
  on public.auth_challenges (id, expires_at)
  where consumed_at is null;

create index if not exists sessions_active_user_lookup
  on public.sessions (user_id, expires_at)
  where revoked_at is null;

comment on table public.sessions is
  'Opaque server session hashes only. API ownership checks use the session user_id; Supabase Auth JWTs are not assumed.';

comment on table public.auth_challenges is
  'Server-created, short-lived, single-use wallet login challenges.';
