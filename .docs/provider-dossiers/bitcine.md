# BitCine Provider Dossier

- **Status:** broken (superseded by Vidking 0-RAM)
- **Provider ID:** bitcine
- **Domain:** bitcine.net
- **Supported content:** movie, series
- **Runtime class:** Playwright lease (Hybrid)
- **Search support:** Yes.
- **Episode/catalog support:** Yes.
- **Stream resolution path:** Mirror of Cineby. Playwright navigates to /movie/{id}?play=true, intercepts network.
- **Quality/source inventory behavior:** Captures first .m3u8.
- **Header/referrer/user-agent requirements:** Injects intercepted headers into mpv.
- **Cache key and TTL recommendations:** 2 hours.
- **Known failure modes:** Identical to Cineby (Cloudflare, DOM timeouts).
- **What is proven in production code:** Works identically to Cineby.
- **What is only proven in experiments:** Is a wrapper for Vidking.
- **Minimum tests/fixtures needed before Provider SDK promotion:** Migrate to 0-RAM.

## Subtitle Resolution
- **Current production subtitle behavior:** Network sniffing during Playwright session.
- **Experimental/research subtitle findings:** Same as Cineby.
- **Exact endpoint or network pattern if known:** Match on .vtt / .srt.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Embed network sniffing.
- **Language matching rules:** First seen.
- **SDH/hearing-impaired filtering recommendation:** None currently.
- **CLI/mpv format preference:** --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Yes.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** Currently Playwright.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Lazy loading misses the request.
- **Exact production gap:** Unreliable timing.
- **Minimum production fix needed:** Switch to 0-RAM Wyzie API.
- **Tests/fixtures needed before claiming subtitle support works:** N/A.
