# Cineby Provider Dossier

- **Status:** broken (superseded by Vidking 0-RAM)
- **Provider ID:** cineby
- **Domain:** cineby.sc
- **Supported content:** movie, series
- **Runtime class:** Playwright lease (Hybrid)
- **Search support:** Yes.
- **Episode/catalog support:** Yes.
- **Stream resolution path:** Playwright navigates to /tv/{id}/{s}/{e}?play=true, intercepts network.
- **Quality/source inventory behavior:** Captures the first .m3u8 fired in the network.
- **Header/referrer/user-agent requirements:** Injects intercepted headers into mpv.
- **Cache key and TTL recommendations:** 2 hours.
- **Known failure modes:** Cloudflare blocks Playwright.
- **What is proven in production code:** Interception of network requests via Playwright.
- **What is only proven in experiments:** Cineby is just a UI wrapper for Vidking. A 0-RAM approach is possible by bypassing Cineby entirely and hitting api.videasy.net.
- **Minimum tests/fixtures needed before @kunai/core extraction:** Migrate to 0-RAM Vidking logic to deprecate Playwright here.

## Subtitle Resolution
- **Current production subtitle behavior:** Intercepts .vtt, .srt, or sub.wyzie.io network requests during Playwright session.
- **Experimental/research subtitle findings:** Wyzie can be queried directly via 0-RAM.
- **Exact endpoint or network pattern if known:** Regex match on network URLs.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Network sniffing.
- **Language matching rules:** Grabs the first subtitle request seen.
- **SDH/hearing-impaired filtering recommendation:** Hard to filter via network sniffing without reading the file.
- **CLI/mpv format preference:** Passed via --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Happens during page load before mpv launches.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** Currently uses Playwright, SHOULD be 0-RAM.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Lazy-loaded subtitles aren't caught before timeout.
- **Exact production gap:** Subtitles are flaky because they rely on timing of Playwright network events.
- **Minimum production fix needed:** Switch to direct Wyzie API fetch.
- **Tests/fixtures needed before claiming subtitle support works:** N/A (Deprecate Playwright approach).
