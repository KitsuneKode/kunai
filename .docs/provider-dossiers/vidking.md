# Vidking Provider Dossier

- **Status:** production
- **Provider ID:** vidking
- **Domain:** videasy.net
- **Supported content:** movie, series
- **Runtime class:** node fetch (0-RAM)
- **Search support:** Requires external TMDB ID.
- **Episode/catalog support:** Yes, using TMDB ID.
- **Stream resolution path:** Direct API call to api.videasy.net, WASM decryption bypass using empty AES key.
- **Quality/source inventory behavior:** Returns multiple qualities. Selects highest.
- **Header/referrer/user-agent requirements:** Strict Referer: https://www.vidking.net/.
- **Cache key and TTL recommendations:** 2 hours stream TTL. 24h metadata TTL.
- **Known failure modes:** 504 Gateway Timeout if videasy backend is overloaded.
- **What is proven in production code:** 0-RAM extraction using patched WASM module.
- **What is only proven in experiments:** The decoy Hashids algorithm is a trap.
- **Minimum tests/fixtures needed before Provider SDK promotion:** End-to-end tests for WASM loading.

## Subtitle Resolution
- **Current production subtitle behavior:** Direct fetch from sub.wyzie.io using static API key.
- **Experimental/research subtitle findings:** Native API returns list of subtitles.
- **Exact endpoint or network pattern if known:** GET https://sub.wyzie.io/search?id={tmdbId}&key=wyzie-9bafe78d95b0ae85e716d772b4d63ec4&season={season}&episode={episode}
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Wyzie API.
- **Language matching rules:** Matches 'en'.
- **SDH/hearing-impaired filtering recommendation:** Exclude tracks containing 'SDH'.
- **CLI/mpv format preference:** .srt or .vtt passed via --sub-file.
- **Future web format preference:** .vtt.
- **Whether subtitle fetch can happen before playback starts:** Yes, it is an independent API call.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM fetch.
- **Subtitle list cache TTL recommendation:** 24h.
- **Failure modes:** Empty list, API key rotation.
- **Exact production gap:** Need robust fallback if Wyzie goes down.
- **Minimum production fix needed:** Hardcode language preference.
- **Tests/fixtures needed before claiming subtitle support works:** Mock Wyzie API response.
