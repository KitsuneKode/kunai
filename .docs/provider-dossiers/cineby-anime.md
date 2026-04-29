# Cineby-Anime Provider Dossier

- **Status:** broken (superseded by HiAnime / Vidking)
- **Provider ID:** cineby-anime
- **Domain:** cineby.sc
- **Supported content:** anime
- **Runtime class:** Playwright lease (Hybrid)
- **Search support:** Yes (Hits HiAnime API mirror).
- **Episode/catalog support:** Yes.
- **Stream resolution path:** Playwright navigates to /anime/{slug}?episode={n}&play=true, intercepts network.
- **Quality/source inventory behavior:** Captures first .m3u8.
- **Header/referrer/user-agent requirements:** Injects intercepted headers.
- **Cache key and TTL recommendations:** 2 hours.
- **Known failure modes:** Cloudflare blocks.
- **What is proven in production code:** Playwright interception.
- **What is only proven in experiments:** N/A.
- **Minimum tests/fixtures needed before @kunai/core extraction:** Move to 0-RAM.

## Subtitle Resolution
- **Current production subtitle behavior:** Network sniffing.
- **Experimental/research subtitle findings:** Same as Cineby.
- **Exact endpoint or network pattern if known:** N/A.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Sniffing.
- **Language matching rules:** First seen.
- **SDH/hearing-impaired filtering recommendation:** None.
- **CLI/mpv format preference:** --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Yes.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** Playwright.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Timing.
- **Exact production gap:** Unreliable.
- **Minimum production fix needed:** 0-RAM API.
- **Tests/fixtures needed before claiming subtitle support works:** N/A.
