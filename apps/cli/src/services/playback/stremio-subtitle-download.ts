/**
 * Services-layer re-export of the provider package's guarded subtitle
 * download. `infra/` may not import `@kunai/providers` (enforced by
 * boundary-imports.test.ts), so player code reaches the downloader here.
 */
export { fetchStremioSubtitle, type StremioSubtitleFile } from "@kunai/providers/stremio-addon";
