# VidKing Provider Dossier

- **Status:** production (Core Engine)
- **Provider ID:** vidking
- **Domain:** www.vidking.net / api.videasy.net
- **Supported content:** movie, series
- **Runtime class:** node fetch (0-RAM)
- **Consumer Skins:** Cineby, HDToday
- **Multi-Server Support:** Yes (High)

## Request Strategy (0-RAM)

VidKing serves as the backbone for multiple streaming sites. It utilizes a two-tier resolution strategy.

### Tier 1: The `api.videasy.net` Endpoints

The primary way to get high-quality streams is by hitting the JSON API.

| Endpoint      | Commonly Known As | Notes                                          |
| :------------ | :---------------- | :--------------------------------------------- |
| `mb-flix`     | Oxygen / Neon     | Primary default server                         |
| `cdn`         | Hydrogen / Yoru   | Alternative with 4K support                    |
| `downloader2` | Lithium / Cypher  | Backup server                                  |
| `1movies`     | Helium / Sage     | Backup server                                  |
| `meine`       | Localized Audio   | Use `?language=german\|italian\|french`        |
| `hdmovie`     | Packaged Audio    | Use for English/Hindi (filter `quality` field) |

### Decryption Protocol

1. **WASM Layer:** Use `module1_patched.wasm` with `tmdbId` (integer) as the key.
2. **AES Layer:** Decrypt the WASM output using `CryptoJS` with an **empty string** (`""`) as the key.

## Subtitle Resolution

Subtitles are returned within the decrypted JSON. They usually follow a `{ url, language, lang }` structure. If missing, fallback to **Wyzie API** is recommended.

## Known Gaps

- **WASM Maintenance:** The WASM binary occasionally rotates or updates its internal salts.
- **Referer Sensitivity:** Requests to `api.videasy.net` strictly require `Referer: https://www.vidking.net/` or the skin's domain.
