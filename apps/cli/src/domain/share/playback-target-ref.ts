// Kept as the CLI-local import seam. The implementation lives in @kunai/types
// so the CLI and the public docs route cannot drift into incompatible codecs.
export {
  decodePlaybackTargetWebCode,
  encodePlaybackTargetRef,
  encodePlaybackTargetShortCode,
  encodePlaybackTargetWebUrl,
  formatSecondsForUrl,
  KUNAI_WEB_SHARE_ORIGIN,
  parseKunaiShareUrl,
  parsePlaybackTargetRef,
  parseTimestampToSeconds,
  resolveShareAction,
} from "@kunai/types";
export type {
  CatalogNs,
  KunaiShareAction,
  ParsedKunaiShare,
  PlaybackTargetRef,
  ShareAnchor,
  WebSharePresentation,
} from "@kunai/types";
