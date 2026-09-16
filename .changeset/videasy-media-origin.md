---
"@kitsunekode/kunai": patch
---

Fix Videasy handing the player a stream the CDN refuses.

Videasy carries two origins that are not interchangeable: the front-end we
impersonate when calling its API (`cineby.at`), and the origin the media CDN's
hotlink rule accepts. The resolve path reused the first as the second, so the
default movie/series provider shipped a URL that answered 403 the instant it was
resolved — while its own resolve gate probed the correct origin and reported
success, which suppressed falling back to a source that would have played.

The stream origin is now a single constant with no override, so the request that
is verified and the request that is played cannot drift apart.
