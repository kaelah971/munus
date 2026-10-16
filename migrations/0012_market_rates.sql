-- Durable last-known-good informational market rates. Home and form
-- NGN estimates read the freshest trustworthy row when the upstream
-- provider is temporarily unavailable, so a CoinGecko outage never
-- blanks the display. This table is display evidence only: payment
-- quotes never read it and always price from a live upstream rate.

create table if not exists public.market_rates (
  asset text not null,
  quote_currency text not null,
  rate numeric not null check (rate > 0),
  source text not null default '',
  observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (asset, quote_currency)
);

comment on table public.market_rates is
  'Durable informational market data (NIM/NGN). observed_at is the upstream observation time and is never rewritten on read; only a fresh upstream success replaces a row.';
comment on column public.market_rates.rate is
  'Exact decimal NGN per unit. Display only — never payment authority.';
