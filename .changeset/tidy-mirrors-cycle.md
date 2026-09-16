---
"@kitsunekode/kunai": patch
---

Fix provider server cycling skipping rules that never fired.

Rivestream never consulted endpoint health, so a quarantined mirror was
re-requested on every resolve (both the prefetch and the cycle asked it), and
its per-mirror timeout sat above the attempt budget where it could never fire.
It now skips quarantined mirrors before any request, sizes its timeout inside
the attempt budget on every startup profile, and fetches on demand if a mirror
becomes eligible mid-resolve. Miruro joins the same health gate, and its
Cloudflare fail-fast budget tracks the mirror list instead of a hardcoded 2.
