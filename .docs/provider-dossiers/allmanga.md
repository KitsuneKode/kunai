# AllManga Provider Dossier

- **Status:** production
- **Provider ID:** allanime
- **Domain:** allmanga.to / api.allanime.day
- **Supported content:** anime
- **Runtime class:** node fetch (0-RAM)
- **Multi-Server Support:** Yes
- **Server Archetype:** Technical Names

## Server / Source Mapping

AllManga provides multiple sources via their GraphQL API. These are represented as technical names in the payload:

| UI Source Name | Provider Engine | Notes                              |
| :------------- | :-------------- | :--------------------------------- |
| **Default**    | wixmp           | Primary HLS stream (Multi-quality) |
| **Yt-mp4**     | youtube         | Backup MP4 stream                  |
| **S-mp4**      | sharepoint      | Backup MP4 stream                  |
| **Luf-Mp4**    | hianime         | Alternative HLS stream             |
| **Fm-mp4**     | filemoon        | Alternative HLS stream             |

## Sub/Dub Support

AllManga uses a dedicated `translationType` variables in their GraphQL queries:

- `variables.translationType = "sub"`
- `variables.translationType = "dub"`

## Implementation Intelligence

### 0-RAM Strategy

- Use GraphQL queries with **Persisted Query Hashes** to bypass Cloudflare.
- Decrypt the `tobeparsed` blob using **AES-256-CTR**.
- Key: SHA-256(`"Xot36i3lK3:v1"`)

## Known Gaps

- GraphQL endpoint and AES key rotate every few months. Parity with `ani-cli` is essential.
