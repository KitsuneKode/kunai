# Anikai Candidate Dossier

- **Status:** candidate
- **Provider ID:** anikai
- **Domain:** anikai.to
- **Supported content:** anime
- **Runtime class:** harvest-and-fetch (JIT Playwright Fallback)
- **Search support:** Yes, but backend accepts internal ani_id.
- **Episode/catalog support:** Yes, via AJAX /ajax/episodes/list.
- **Stream resolution path:** Playwright bypasses Cloudflare, clicks episode, intercepts /ajax/links/view, navigates into internal iframe, extracts 3rd-party embed URL.
- **Quality/source inventory behavior:** Waterfall fallback required. Must loop through Server 1, Server 2 to find supported hosts.
- **Header/referrer/user-agent requirements:** Exact User-Agent match required for Cloudflare clearance token.
- **Cache key and TTL recommendations:** Cache Cloudflare tokens for 2 hours. Cache stream URLs for 2 hours.
- **Known failure modes:** Cloudflare ERR_ABORTED during initial navigation.
- **What is proven in production code:** N/A.
- **What is only proven in experiments:** The entire iframe wrapper extraction flow and the server fallback loop.
- **Minimum tests/fixtures needed before @kunai/core extraction:** Test the Client-Side Unpacker regex against mocked Dean Edwards packed strings.

## Subtitle Resolution
- **Current production subtitle behavior:** Untested.
- **Experimental/research subtitle findings:** Anikai typically hardcodes subs or relies on the 3rd-party embed player to load them.
- **Exact endpoint or network pattern if known:** Unknown.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Missing / Hardsub.
- **Language matching rules:** Toggled via UI Server Selection (e.g. [SUB] vs [DUB]).
- **SDH/hearing-impaired filtering recommendation:** N/A.
- **CLI/mpv format preference:** N/A.
- **Future web format preference:** N/A.
- **Whether subtitle fetch can happen before playback starts:** Unknown.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** Unknown.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Missing soft subs.
- **Exact production gap:** No soft sub extraction implemented for Anikai yet.
- **Minimum production fix needed:** Rely on HardSubs for V1.
- **Tests/fixtures needed before claiming subtitle support works:** Sniff network traffic on Vidstreaming embed to locate soft sub API.
