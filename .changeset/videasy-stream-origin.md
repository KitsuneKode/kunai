---
"@kitsunekode/kunai": patch
---

Fix Videasy shipping streams that could not be opened, on the server it picks most often.

Videasy checked each candidate stream before offering it, and reported the check
had passed — then playback failed immediately. The check and the player were not
asking the same thing: the check sent one `Origin` header and the stream Kunai
handed to mpv carried another, and the CDN behind Videasy's Yoru server accepts
the first and refuses the second. So the provider verified a request that was
never made, and the failure only appeared once the player had already started.

Both now send the origin of the player these sites actually embed, taken from
one place so they cannot drift apart again. Where this was failing it now plays;
the other Videasy servers accept either header and are unaffected.
