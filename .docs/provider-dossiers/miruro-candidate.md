# Miruro Candidate Dossier

- **Status:** candidate
- **Provider ID:** miruro
- **Domain:** miruro.tv / theanimecommunity.com
- **Supported content:** anime
- **Runtime class:** node fetch (True 0-RAM via backend bypass)
- **Search support:** N/A (We bypass search by using AniList ID directly).
- **Episode/catalog support:** Yes, via theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID={id}.
- **Stream resolution path:** Direct API call to backend database, bypassing Miruro frontend Cloudflare.
- **Quality/source inventory behavior:** Returns native HLS playlists in multiple qualities.
- **Header/referrer/user-agent requirements:** Referer: https://www.miruro.tv/ is strictly required by the CDN.
- **Cache key and TTL recommendations:** 2 hours for stream URLs.
- **Known failure modes:** Backend API could add auth headers or rate limits in the future.
- **What is proven in production code:** N/A.
- **What is only proven in experiments:** The backend database accepts raw AniList IDs directly, avoiding Cloudflare and scraping entirely.
- **Minimum tests/fixtures needed before @kunai/core extraction:** E2E test hitting theanimecommunity.com.

## Subtitle Resolution
- **Current production subtitle behavior:** Untested.
- **Experimental/research subtitle findings:** Streams provided by Miruro backend often include embedded soft subs in the .m3u8 manifest, or the backend API returns a subtitle array.
- **Exact endpoint or network pattern if known:** Inside /api/secure/pipe (if using frontend) or embedded in HLS.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Provider payload / Manifest.
- **Language matching rules:** Matches 'en'.
- **SDH/hearing-impaired filtering recommendation:** Exclude SDH if possible.
- **CLI/mpv format preference:** Native HLS sub track.
- **Future web format preference:** Native HLS sub track.
- **Whether subtitle fetch can happen before playback starts:** Tied to stream manifest.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM fetch.
- **Subtitle list cache TTL recommendation:** 2 hours.
- **Failure modes:** Manifest missing English track.
- **Exact production gap:** Subtitle track selection must be passed to mpv.
- **Minimum production fix needed:** Pass --slang=en to mpv.
- **Tests/fixtures needed before claiming subtitle support works:** Verify HLS manifest contains subtitle tracks.
