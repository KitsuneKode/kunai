-- A returning install must keep the day it was first seen. Prune used to
-- delete that date, and the next ping inserted first_seen = the return day,
-- so every earlier rollup dropped from 1 to 0. Rows pruned before this
-- column existed stay null and still count on every day.

alter table retired_install add column if not exists first_seen date;
