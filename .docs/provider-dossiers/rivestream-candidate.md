# Rivestream Candidate Dossier

- **Status:** candidate
- **Provider ID:** rivestream
- **Domain:** rivestream.app
- **Supported content:** movie, series
- **Runtime class:** node fetch (True 0-RAM)
- **Search support:** Yes, via /api/backendfetch?requestID=searchMulti.
- **Episode/catalog support:** Yes, uses TMDB ID natively.
- **Stream resolution path:** Generates custom Base64 MurmurHash secretKey locally, fetches JSON payload, extracts direct .m3u8 or Torrent links.
- **Quality/source inventory behavior:** Returns multiple qualities (1080p, 720p). Select highest.
- **Header/referrer/user-agent requirements:** Standard headers, Referer: https://www.rivestream.app/.
- **Cache key and TTL recommendations:** 2 hours.
- **Known failure modes:** Upstream API changes the 64-string cArray salt or hashing math.
- **What is proven in production code:** N/A.
- **What is only proven in experiments:** The entire bitwise hashing algorithm ported to TypeScript.
- **Minimum tests/fixtures needed before @kunai/core extraction:** Unit tests for generateSecretKey(tmdbId) verifying it matches the browser output.

## Subtitle Resolution
- **Current production subtitle behavior:** Untested.
- **Experimental/research subtitle findings:** Rivestream has a dedicated subtitle endpoint.
- **Exact endpoint or network pattern if known:** /api/backendfetch?requestID=movieOnlineSubtitles&id={tmdbId}&secretKey={secretKey}
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Provider API payload.
- **Language matching rules:** Filter JSON array for lang: 'en'.
- **SDH/hearing-impaired filtering recommendation:** N/A.
- **CLI/mpv format preference:** .vtt via --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Yes, independent API call.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM fetch.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** API key hash failure.
- **Exact production gap:** None, logic is clean.
- **Minimum production fix needed:** Implement the API call in the provider class.
- **Tests/fixtures needed before claiming subtitle support works:** Test movieOnlineSubtitles endpoint with known TMDB ID.
