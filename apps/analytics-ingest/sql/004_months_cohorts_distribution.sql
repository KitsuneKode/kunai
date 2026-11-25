-- Monthly actives, v2 cohorts, and public distribution counts.
--
-- Still never stores raw install UUIDs, IPs, titles, or queries. month_active
-- holds the same HMAC ping_day already holds, for about as long; everything
-- else here is an aggregate count with no identity.
--
-- Applied after 003_new_installs.sql by scripts/migrate.ts. Every statement is
-- idempotent, so a re-run is a no-op.

-- One row per install per calendar month. A v2 id rotates every month, so a
-- row here can never be linked to the same install's row in another month; a
-- v1 hash never rotates and is exactly as linkable as it already is in
-- ping_day. cohort is the v2 enable month, null for v1.
--
-- Rows for a month are deleted once the following month is a week old, after
-- the cron has folded them into month_rollup and cohort_rollup. That keeps a
-- per-install row for at most about 38 days, close to ping_day's 35.
create table if not exists month_active (
  month        date  not null,
  install_hash bytea not null,
  cohort       date,
  primary key (month, install_hash)
);

-- Unique active installs per calendar month, v1 and v2 together. Permanent,
-- counts only.
create table if not exists month_rollup (
  month           date        primary key,
  active_installs integer     not null,
  computed_at     timestamptz not null default now()
);

-- v2 installs of each cohort active in each month. Row (C, C) is cohort C's
-- size, which is the new-install count for month C; row (C, C+k) is its Mk
-- retention. Permanent, counts only.
create table if not exists cohort_rollup (
  cohort      date        not null,
  month       date        not null,
  installs    integer     not null,
  computed_at timestamptz not null default now(),
  primary key (cohort, month)
);

-- Daily snapshots of public download counters: GitHub release assets and npm
-- package downloads. Nothing in this table comes from a Kunai client.
-- cumulative is the counter as read on day; deltas come from consecutive days.
create table if not exists distribution_daily (
  day        date   not null,
  source     text   not null,
  release    text   not null default '',
  platform   text   not null,
  cumulative bigint not null,
  primary key (day, source, release, platform)
);

-- Seed the months ping_day still covers from their first day, so the first
-- month_rollup after deploy is not a partial count. A month whose first days
-- are already pruned is left out: seeding it would publish an undercount as
-- that month's final figure. Only v1 rows exist yet; their cohort is null.
insert into month_active (month, install_hash, cohort)
select distinct date_trunc('month', day)::date, install_hash, null::date from ping_day
where date_trunc('month', day)::date >= (select min(day) from ping_day)
on conflict (month, install_hash) do nothing;
