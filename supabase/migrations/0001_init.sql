-- JARVIS Trade Log : initial schema
-- 個人用MVP。RLSは有効化しつつ anon 全許可（本番運用時は auth に置換すること）

create type stock_status as enum ('買い候補','押し目待ち','保有中','見送り','危険');
create type stock_rank   as enum ('S','A','B','C');
create type macd_state   as enum ('ゴールデンクロス','デッドクロス','上昇中','下降中','横ばい','不明');

create table stocks (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  market text,
  theme text,
  per numeric,
  pbr numeric,
  roe numeric,
  sales_growth numeric,
  operating_margin numeric,
  rsi numeric,
  macd macd_state default '不明',
  current_price numeric,
  stop_loss numeric,
  take_profit numeric,
  rank stock_rank default 'B',
  status stock_status default '買い候補',
  memo text,
  price_updated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index stocks_code_idx on stocks(code);

create table holdings (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  buy_price numeric not null,
  shares integer not null,
  stop_loss numeric,
  take_profit numeric,
  created_at timestamptz default now()
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  market_note text,
  traded_stocks text,
  buy_reason text,
  sell_reason text,
  emotion_note text,
  reflection text,
  jarvis_comment text,
  created_at timestamptz default now()
);

alter table stocks enable row level security;
alter table holdings enable row level security;
alter table journal_entries enable row level security;

create policy "anon all stocks"   on stocks   for all using (true) with check (true);
create policy "anon all holdings" on holdings for all using (true) with check (true);
create policy "anon all journal"  on journal_entries for all using (true) with check (true);
