# BitCine Provider Dossier

- **Status:** research wrapper over VidKing/Videasy 0-RAM, not a standalone production provider.
- **Provider ID:** bitcine
- **Domain:** bitcine.tv
- **Supported content:** movie, series
- **Runtime class:** direct HTTP through Videasy endpoints.
- **Search support:** site UI only. Kunai runtime uses canonical catalog ids.
- **Episode/catalog support:** site UI paths such as `/tv/{tmdbId}/{season}/{episode}` map to Videasy episode resolves.
- **Stream resolution path:** BitCine's Next.js player bundle wires server aliases to `api.videasy.net/{endpoint}/sources-with-title`.
- **Quality/source inventory behavior:** server aliases are ordered and user-visible. Kunai maps them through `packages/providers/src/videasy/flavors.ts`.
- **Header/referrer/user-agent requirements:** inherited from VidKing/Videasy direct resolver.
- **Cache key and TTL recommendations:** inherited from source inventory and stream manifest cache policy.
- **Known failure modes:** Videasy endpoint 404/timeout, upstream source missing, provider TOS video replacement, stale cached source inventory.
- **What is proven in production code:** VidKing direct resolver can map and cycle the BitCine server table as 0-RAM sources.
- **What is only proven in experiments:** BitCine UI controls and favorites behavior.
- **Minimum tests/fixtures needed before Provider SDK promotion:** keep BitCine as alias evidence unless it gains a distinct backend.

## 2026-06-03 Bundle Evidence

Observed from:

- `https://www.bitcine.tv/tv/97546/3/1`
- `https://www.bitcine.tv/_next/static/chunks/4035-d850e748e69a4451.js`

Playback server order in the bundle:

| UI alias | Videasy endpoint             | Kunai flavor               |
| -------- | ---------------------------- | -------------------------- |
| Neon     | `mb-flix`                    | Luffy                      |
| Yoru     | `cdn`                        | Zoro, English, may have 4K |
| Cypher   | `downloader2`                | Nami                       |
| Sage     | `1movies`                    | Sanji                      |
| Breach   | `m4uhd`                      | Blackbeard                 |
| Vyse     | `hdmovie` + `English` filter | Robin                      |
| Killjoy  | `meine?language=german`      | Brook                      |
| Fade     | `hdmovie` + `Hindi` filter   | Chopper                    |
| Omen     | `lamovie`                    | Ace                        |
| Raze     | `superflix`                  | Sabo                       |

## Subtitle Resolution

- **Current production subtitle behavior:** inherited from VidKing resolver and late subtitle lookup.
- **Experimental/research subtitle findings:** same Videasy payload shape as VidKing/Cineby.
- **Exact endpoint or network pattern if known:** Videasy source payload plus subtitle candidates when exposed.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** provider payload when exposed; Wyzie late lookup when inventory lacks the configured language.
- **Language matching rules:** ISO-normalized in provider result.
- **SDH/hearing-impaired filtering recommendation:** prefer provider-native labels when present, otherwise preserve as diagnostics only.
- **CLI/mpv format preference:** attach provider/wyzie subtitles through mpv.
- **Future web format preference:** `.vtt` where available.
- **Whether subtitle fetch can happen before playback starts:** yes when provider payload exposes it; otherwise late lookup after playback.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM.
- **Subtitle list cache TTL recommendation:** use provider subtitle-list TTL.
- **Failure modes:** provider payload omits language, late lookup returns no selectable URL.
- **Exact production gap:** BitCine should remain evidence for VidKing flavor mapping, not a separate provider path.
- **Tests/fixtures needed before claiming subtitle support works:** VidKing source/subtitle inventory tests cover the runtime path.
