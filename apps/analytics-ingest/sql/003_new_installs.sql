-- Installs first seen on each rollup day — the "new installs" series.
--
-- `new_installs` is exact wherever it can be read. A row with first_seen = D
-- has last_seen >= D, so lifetime pruning cannot remove it until D is older
-- than the retention window — long past every day the raw window can still
-- roll up or the published series can still show. Days older than retention
-- get a floor instead: installs that were first seen and retired before this
-- column existed carried their first_seen away with them, and that history is
-- outside every window the endpoints serve.
--
-- A return after retirement reads as a new install on the return day — the
-- fold into lifetime_retired discards identity, so it is indistinguishable
-- from a first-ever ping. That is the published cumulative-observations
-- semantics applied to a per-day count.

alter table daily_rollup add column if not exists new_installs integer;

update daily_rollup r
   set new_installs = (select count(*)::int from install_lifetime where first_seen = r.day)
 where new_installs is null;

alter table daily_rollup alter column new_installs set not null;
