---
"@kitsunekode/kunai": patch
---

fix(providers): parse #EXT-X-MEDIA renditions into audio/subtitle inventory

`expandHlsMasterPlaylist` only read `#EXT-X-STREAM-INF` rows, so alternate
audio and subtitle renditions declared on HLS masters never reached the Tracks
panel. `expandHlsMasterInventory` now returns variants plus rendition tracks;
muxed audio (no `URI`) still contributes its language to `audioLanguages`, and
vidlink HLS streams carry the manifest subtitles the provider omitted (#189).
