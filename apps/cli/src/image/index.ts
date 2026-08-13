// =============================================================================
// image/index.ts — terminal image capability surface.
//
// This module used to also own `displayPoster`, a file-based one-shot renderer
// that fetched a poster to the OS cache dir and painted it through
// `renderPosterFile`. The Ink app shell renders posters from bytes it already
// holds (`app-shell/poster-renderer.ts`), so nothing in production called that
// chain -- only its own tests did. It was removed rather than migrated: it was
// the last caller of ImageMagick that never tried `Bun.Image` first, so keeping
// it meant keeping a second, slower conversion path alive for no user.
//
// What remains here is capability detection, which the shell and `ui.ts` do use.
// =============================================================================

export { detectImageCapability, detectTerminal, isKittyCompatible } from "./capability";
export type {
  ImageCapability,
  ImageProtocol,
  ImageRenderOptions,
  ImageRendererId,
  TerminalId,
} from "./types";
