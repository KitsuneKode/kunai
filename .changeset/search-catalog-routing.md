---
"@kitsunekode/kunai": patch
---

Filtered provider search now routes through the provider's `catalogIdentity`
instead of a hardcoded compatibility list — vidlink and rivestream searches
were silently dead after videasy went dark because their catalogs were never
declared compatible. Every future provider gets working filtered search by
declaring its catalog, not by editing a list.

The videasy catalog endpoint walks the known mirror chain (db.wingsdatabase.com
first) instead of hitting the dead canonical host, and search-cache eviction
now skips overwritten entries and expires the earliest-deadline row first.
