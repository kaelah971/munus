-- Server-persisted Nimiq Pay exposed account set per authenticated user.
-- Home funding context must survive webview localStorage loss, remounts,
-- and device lifecycle: the set established during explicit Connect is
-- the source of truth, and silent restores read it back for server-side
-- balance aggregation. Addresses are public on-chain data, scoped to the
-- canonical user, never auth identity, never arbitrary querying.

create table if not exists public.user_wallet_accounts (
  user_id uuid not null references public.users(id) on delete cascade,
  address text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, address)
);

comment on table public.user_wallet_accounts is
  'Nimiq Pay host-exposed account set per user. Written only from explicit Connect/diagnostics discovery; read on silent restore for aggregate funding display.';
