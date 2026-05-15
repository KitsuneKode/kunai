# Miruro Provider Dossier

- **Status:** candidate active module
- **Provider ID:** miruro
- **Domain:** www.miruro.tv
- **Supported content:** anime
- **Runtime class:** node fetch (0-RAM) with XOR + Gzip
- **Multi-Server Support:** Yes (High)
- **Server Archetype:** Animals

## Animal Server Mapping

Miruro uses animal names to represent different streaming mirrors and subtitle modes (Hardsub vs. Softsub):

| UI Server Name | Subtitle Mode        | Type   | Capabilities                                |
| :------------- | :------------------- | :----- | :------------------------------------------ |
| **kiwi**       | **Hardsub (Sub)**    | Native | Primary Hardsub server, high reliability    |
| **telli**      | Hardsub (Sub)        | Embed  | Backup for kiwi (Iframe)                    |
| **bee**        | **Soft-sub (S-Sub)** | Native | Primary Softsub server, includes Thumbnails |
| **bun**        | Soft-sub (S-Sub)     | Embed  | Backup for bee (Iframe)                     |
| **dune**       | Soft-sub (S-Sub)     | Native | Alternative native softsub                  |
| **ally**       | **Hardsub (Sub)**    | Native | Alternative native hardsub                  |
| **nun**        | Hardsub (Sub)        | Embed  | Backup for ally (Iframe)                    |
| **hop**        | Soft-sub (S-Sub)     | Native | Alternative native softsub                  |

## Implementation Intelligence

### 0-RAM Strategy (The Pipe API)

Miruro uses a "Pipe" API that proxies requests to their actual backend (`theanimecommunity.com`).

**Endpoint:** `https://www.miruro.tv/api/secure/pipe?e={base64url-payload}`

**Encryption Key (Rolling XOR):** `71951034f8fbcf53d89db52ceb3dc22c`

**Decryption Algorithm:**

1. Base64url-decode the response.
2. XOR each byte with the key (at `i % 32`).
3. If first 2 bytes are `1f 8b`, decompress with **Gzip**.
4. Parse the resulting JSON.

### Request Payload Construction

```json
{
  "path": "sources",
  "method": "GET",
  "query": {
    "episodeId": "...",
    "provider": "kiwi",
    "category": "sub",
    "anilistId": "..."
  },
  "body": null,
  "version": "0.2.0"
}
```

_Note: `base64url` encode this JSON and append to the `?e=` param._

## Multi-Audio (Dub) Support

Miruro supports Dub by changing the `category` in the pipe query from `"sub"` to `"dub"`.

- **Important:** Not all animal servers support `dub`. The `kiwi` and `bee` servers usually have the best coverage for both categories.

## Known Gaps

- **Cloudflare Rate Limiting:** The Pipe API is sensitive. Implement exponential backoff.
- **TLS Fingerprinting:** Standard `fetch` sometimes gets blocked while `curl` (TLS 1.2) works. Using a browser-like User-Agent and specific header ordering is recommended.
