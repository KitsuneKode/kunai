-- Production hardening. Still never stores raw install UUIDs, IPs, titles, or
-- queries; every object below holds either a bounded counter or the same
-- HMAC 001_init.sql already defined.
--
-- Applied after 001_init.sql by scripts/migrate.ts. Every statement is
-- idempotent, so a re-run is a no-op.

-- Per-UTC-day global admission budget.
--
-- There is no per-client rate limit and there cannot be one: the ingest never
-- reads a client IP, and the only other key -- install_hash -- is chosen by the
-- client, so minting a fresh UUID resets any limit built on it. What is left is
-- a global ceiling on how many pings one UTC day may write. It bounds storage
-- and database cost against a flood without identifying anybody.
create table if not exists ingest_budget (
  day      date   primary key,
  attempts bigint not null default 0
);

-- Installs deleted by lifetime retention, so the exact lifetime count survives
-- their rows. One row, id = 1.
create table if not exists lifetime_retired (
  id               smallint primary key,
  retired_installs bigint   not null default 0
);

insert into lifetime_retired (id, retired_installs) values (1, 0) on conflict (id) do nothing;

-- last_seen exists to make deletion possible. Without it install_lifetime can
-- only ever grow, so the durable pseudonymous set is unbounded in both cost and
-- exposure. It is a date, never leaves the database, and is written at most
-- once per install per day.
alter table install_lifetime add column if not exists last_seen date;

update install_lifetime set last_seen = first_seen where last_seen is null;

alter table install_lifetime alter column last_seen set not null;

-- ping_day_day_idx from 001_init.sql is redundant: the primary key
-- (day, install_hash) already leads with day, so it serves both `where day = $1`
-- and `where day < $1`. Keeping it only doubled the index writes on the hottest
-- path in the system.
drop index if exists ping_day_day_idx;

-- Covers the three `group by` rollup queries index-only: day is the leading
-- column, and version/os/arch are all present, so the aggregate never touches
-- the heap.
create index if not exists ping_day_day_dimensions_idx on ping_day (day, version, os, arch);

-- `count(*) ... where first_seen <= $1` for the as-of-day lifetime figure.
create index if not exists install_lifetime_first_seen_idx on install_lifetime (first_seen);

-- Retention scan for pruneLifetimeBefore.
create index if not exists install_lifetime_last_seen_idx on install_lifetime (last_seen);
