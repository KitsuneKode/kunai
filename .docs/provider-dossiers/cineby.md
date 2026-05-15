# Cineby Provider Dossier (VidKing Flavor)

- **Status:** research flavor wrapper (not in default fallback order)
- **Provider ID:** cineby
- **Skin For:** VidKing (api.videasy.net)
- **Domain:** cineby.sc
- **Supported content:** movie, series
- **Runtime class:** node fetch (0-RAM)
- **Multi-Audio Support:** Yes (High)
- **Server Archetype:** Valorant Agents

## Valorant Agent Server Mapping

Cineby maps Valorant agent names to specific `api.videasy.net` endpoints or filtering logic:

| UI Server Name | API Endpoint / Param     | Audio Language | Notes                                      |
| :------------- | :----------------------- | :------------- | :----------------------------------------- |
| **Neon**       | `mb-flix`                | Original (EN)  | Default primary server                     |
| **Yoru**       | `cdn`                    | Original (EN)  | High bit-rate / 4K support                 |
| **Cypher**     | `downloader2`            | Original (EN)  | Backup primary                             |
| **Sage**       | `1movies`                | Original (EN)  | Backup primary                             |
| **Breach**     | `m4uhd`                  | Original (EN)  |                                            |
| **Vyse**       | `hdmovie`                | English        | Filter sources for `quality === "English"` |
| **Killjoy**    | `meine?language=german`  | **German**     | Native German audio                        |
| **Harbor**     | `meine?language=italian` | **Italian**    | Native Italian audio                       |
| **Chamber**    | `meine?language=french`  | **French**     | Native French audio (Movies only)          |
| **Fade**       | `hdmovie`                | **Hindi**      | Filter sources for `quality === "Hindi"`   |
| **Omen**       | `lamovie`                | **Spanish**    | Native Spanish audio                       |
| **Raze**       | `superflix`              | **Portuguese** | Native Portuguese audio                    |

## Implementation Intelligence

### Multi-Audio Selection

When a user selects a specific language, the provider must switch the backend endpoint.

- For **German/Italian/French**: Hit `https://api.videasy.net/meine/sources-with-title?...&language={lang}`.
- For **Hindi/English**: Hit `https://api.videasy.net/hdmovie/sources-with-title?...` and post-process the `sources` array to find the entry where the `quality` field contains the language name.

### 0-RAM Strategy

- Use the **VidKing WASM SDK** (`module1_patched.wasm`) to decrypt the response.
- Use the **Empty AES Key** (`""`) for the final decryption stage.
- Pass the integer `tmdbId` as the key to the WASM `decrypt` function.

## Known Gaps

- Cineby's own site is protected by Cloudflare, but the underlying `api.videasy.net` endpoints are often reachable with the correct `Origin: https://www.vidking.net` and `Referer: https://www.vidking.net/` headers.
