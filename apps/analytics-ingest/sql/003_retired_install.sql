-- Identifies a pruned install so a later return is one install, not two.
--
-- lifetime_retired.retired_installs stays as the count of rows pruned before
-- this table existed. New prunes insert the hash here and do not bump that
-- counter. A returning ping deletes its hash, so it is only in install_lifetime.

create table if not exists retired_install (
  install_hash bytea primary key
);
