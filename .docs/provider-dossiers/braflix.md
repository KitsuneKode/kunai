# Braflix Provider Dossier

- **Status:** production
- **Provider ID:** braflix
- **Domain:** braflix.mov
- **Supported content:** movie, series
- **Runtime class:** browser-safe fetch (HTML parsing) -> Playwright lease
- **Search support:** Yes, custom HTML scraping.
- **Episode/catalog support:** Yes, custom HTML scraping.
- **Stream resolution path:** Scrapes HTML for episodes, then uses Playwright to intercept the actual stream from the embedded player.
- **Quality/source inventory behavior:** Relies on Playwright interception.
- **Header/referrer/user-agent requirements:** Standard headers for HTML fetch.
- **Cache key and TTL recommendations:** 2 hours.
- **Known failure modes:** HTML structure changes frequently.
- **What is proven in production code:** HTML parsing for catalog.
- **What is only proven in experiments:** N/A.
- **Minimum tests/fixtures needed before @kunai/core extraction:** Regex stability tests for HTML parsing.

## Subtitle Resolution
- **Current production subtitle behavior:** Network sniffing during Playwright session.
- **Experimental/research subtitle findings:** None.
- **Exact endpoint or network pattern if known:** N/A.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Embed network sniffing.
- **Language matching rules:** First seen.
- **SDH/hearing-impaired filtering recommendation:** None.
- **CLI/mpv format preference:** --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Yes.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** Currently Playwright.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Lazy loading.
- **Exact production gap:** Unreliable timing.
- **Minimum production fix needed:** Direct API extraction.
- **Tests/fixtures needed before claiming subtitle support works:** N/A.
