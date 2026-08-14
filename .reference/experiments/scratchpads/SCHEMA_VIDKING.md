### VIDKING SCHEMA (api.videasy.net)

**Note:** The payload is AES encrypted. Once decrypted, it returns:

```json
{
  "sources": [
    { "url": "https://cdn.../1080/index.m3u8", "quality": "1080p", "isM3U8": true },
    { "url": "https://cdn.../720/index.m3u8", "quality": "720p", "isM3U8": true }
  ],
  "subtitles": [
    { "url": "https://...", "lang": "eng", "language": "English" },
    { "url": "https://...", "lang": "eng", "language": "English (SDH)" }
  ]
}
```

**Sub/Dub Handling:** Vidking does not explicitly mark HardSub vs SoftSub in the source URL. It is assumed the video is raw and the 'subtitles' array provides the soft subs.
**Title Mapping:** Vidking uses TMDB IDs natively. It does not provide JP/EN title mappings; it relies on TMDB for metadata.
