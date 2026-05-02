# AllManga-Compatible API Client Provider Dossier

- **Status:** production
- **Provider ID:** allanime today; intended display/runtime naming is AllManga-compatible until the config/provider ID rename is completed.
- **Domain:** allmanga.to / api.allanime.day
- **Supported content:** anime
- **Runtime class:** node fetch (0-RAM)
- **Search support:** Yes, native GraphQL.
- **Episode/catalog support:** Yes, native GraphQL.
- **Stream resolution path:** Fetches encrypted payload, decodes hex, decrypts AES-256-CTR, extracts wixmp/m3u8.
- **Quality/source inventory behavior:** Provides multiple qualities in the decrypted payload.
- **Header/referrer/user-agent requirements:** Specific Referer and User-Agent required by the API.
- **Cache key and TTL recommendations:** 2 hours for streams, 24h for catalog.
- **Known failure modes:** GraphQL endpoint rotation, AES key rotation.
- **What is proven in production code:** Reliable AES decryption and GraphQL querying in `packages/providers/src/allmanga/api-client.ts`.
- **What is only proven in experiments:** N/A.
- **Minimum tests/fixtures needed before Provider SDK promotion:** AES decryption and episode-string parity tests.

## Subtitle Resolution

- **Current production subtitle behavior:** Subtitles are typically hard-coded (HardSub) or provided in the m3u8 playlist.
- **Experimental/research subtitle findings:** No external API required.
- **Exact endpoint or network pattern if known:** Embedded in stream manifest.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Provider payload / Embedded in stream.
- **Language matching rules:** Uses sub/dub GraphQL translation type.
- **SDH/hearing-impaired filtering recommendation:** N/A (handled upstream).
- **CLI/mpv format preference:** Native m3u8 handling.
- **Future web format preference:** Native m3u8 handling.
- **Whether subtitle fetch can happen before playback starts:** No, tied to stream.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM fetch.
- **Subtitle list cache TTL recommendation:** 2 hours (tied to stream).
- **Failure modes:** HardSubs cannot be turned off.
- **Exact production gap:** Cannot inject custom font styling for HardSubs.
- **Minimum production fix needed:** UI indicator showing if stream is HardSub.
- **Tests/fixtures needed before claiming subtitle support works:** Test GraphQL query for sub/dub and HLS subtitle track exposure.
