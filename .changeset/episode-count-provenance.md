---
"@kitsunekode/kunai": patch
---

fix(catalog): log provenance when a non-integer episode count is dropped

The `readEpisodeCount` guards dropped fractional values silently, so the
"episodes 448.2" producer stayed anonymous. Both ingestion sites (TMDB season
rows, AniList media) now emit one `dbg` record naming the site, the raw value,
and the title id when a present-but-invalid count is rejected (#273).
