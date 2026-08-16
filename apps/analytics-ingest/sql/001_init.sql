-- Kunai usage analytics. Never store raw install UUIDs, IPs, titles, or queries.
--
-- ping_day.install_hash is HMAC-SHA256(ANALYTICS_HASH_SECRET, installId). The
-- primary key IS the once-per-install-per-day gate: an ON CONFLICT DO NOTHING
-- insert is atomic, which a separate claim-then-record pair was not.

create table if not exists ping_day (
  day          date        not null,
  install_hash bytea       not null,
  version      text        not null,
  os           text        not null,
  arch         text        not null,
  -- Ships empty. No wire field writes to it until a deliberate change opens
  -- one; the payload key-set check rejects a sixth key today.
  extra        jsonb       not null default '{}'::jsonb,
  first_seen   timestamptz not null default now(),
  primary key (day, install_hash)
);

create index if not exists ping_day_day_idx on ping_day (day);

-- One permanent hashed row per install, holding only a first-seen date. This
-- is a durable pseudonymous record where a HyperLogLog kept only a sketch --
-- it is what an exact lifetime count costs. Stated plainly in
-- .docs/analytics-privacy-contract.md rather than implied to be equivalent.
create table if not exists install_lifetime (
  install_hash bytea primary key,
  first_seen   date not null
);

-- Permanent, and contains no identity of any kind.
create table if not exists daily_rollup (
  day               date primary key,
  active_installs   integer     not null,
  by_version        jsonb       not null,
  by_os             jsonb       not null,
  by_arch           jsonb       not null,
  lifetime_installs integer     not null,
  computed_at       timestamptz not null default now()
);
