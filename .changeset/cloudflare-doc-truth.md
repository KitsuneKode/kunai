---
"@kitsunekode/kunai": patch
---

docs(dossiers): describe the Cloudflare strategy that shipped

The dossier documented a Playwright `cf_clearance` "Harvest & Fetch" pipeline
that was never built — no browser dependency, no clearance harvesting, no
daemon. Rewritten to describe the real implementation: PATH-discovered
`curl_<browser><version>` impersonate wrappers ranked by family, Darwin-only
cipher flags for plain curl, and challenge detection on 2xx bodies; plus the
troubleshooting flow that matches what the code actually does.
