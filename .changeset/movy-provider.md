---
"@kitsunekode/kunai": minor
---

Adds Movy (movy.sx) as an opt-in provider — a 16-lane STREAMCRYPTO aggregator
whose lanes each wrap a different upstream scraper, surfaced as switchable
sources in the tracks panel.

Failure classification matches the repo's honesty contract: an HTTP answer
from a lane is upstream evidence (5xx/429 retryable, 404/410 a definitive
miss), a decrypt or magic-check failure is a parse failure that does not
retry, and a raw transport error reaches the offline gate unwrapped. A caller
abort records nothing. The per-candidate timeout now actually cancels the
lane fetch instead of leaking the socket past the 15s bound.

Not in `providerPriority` — a new aggregator stays opt-in until the live
smoke proves the wire format on a clean network.
