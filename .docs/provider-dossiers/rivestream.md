# Rivestream Provider Dossier

- **Status:** candidate
- **Provider ID:** rivestream
- **Domain:** rivestream.app
- **Supported content:** movie, series
- **Runtime class:** node fetch (0-RAM)
- **Multi-Server Support:** Yes
- **Server Archetype:** Service Providers

## Server / Service Mapping

Rivestream acts as a meta-aggregator, mapping its "services" to various upstream providers. These are passed via the `service` query parameter in the `backendfetch` API:

| Service Name | Notes                  |
| :----------- | :--------------------- |
| **flowcast** | Primary HLS provider   |
| **vidplay**  | Alternative provider   |
| **filemoon** | Alternative provider   |
| **embed**    | Direct iframe fallback |

## Implementation Intelligence

### 0-RAM Strategy

Rivestream uses a custom hashing algorithm to generate a `secretKey` based on the TMDB ID and a rotating salt.

**Secret Key Generation:**

1. Use bitwise MurmurHash-like operations on the TMDB ID.
2. Apply a 64-character salt table (`cArray`).
3. Base64 encode the result.

### Subtitle Resolution

Rivestream provides a dedicated endpoint for subtitles:
`https://www.rivestream.app/api/backendfetch?requestID={type}OnlineSubtitles&id={tmdbId}&secretKey={secretKey}`

## Known Gaps

- The `cArray` salt rotates frequently. A fallback to Playwright/Scraping may be necessary if the salt cannot be dynamically retrieved.
