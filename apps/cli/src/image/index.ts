import { getCachedPoster } from "./cache";
import { detectImageCapability } from "./capability";
import { debugImage } from "./debug";
import { NonPngError, renderChafaKitty, renderPosterFile } from "./renderers";
import type { ImageRenderOptions } from "./types";

const DEFAULT_SIZE = "30x18";
const DEFAULT_MAX_ROWS = 18;

function resolveImageOptions(options: Partial<ImageRenderOptions> = {}): ImageRenderOptions {
  return {
    size: options.size ?? process.env.KUNAI_IMAGE_SIZE ?? DEFAULT_SIZE,
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    debug: options.debug ?? process.env.KUNAI_IMAGE_DEBUG === "1",
  };
}

export async function displayPoster(
  posterPath: string | null,
  options?: Partial<ImageRenderOptions>,
): Promise<void> {
  if (!posterPath || posterPath.trim().length === 0) return;

  const resolvedOptions = resolveImageOptions(options);
  const capability = detectImageCapability();

  if (!capability.available || capability.renderer === "none") {
    debugImage(`poster skipped: ${capability.reason}`);
    return;
  }

  debugImage(
    `terminal=${capability.terminal} renderer=${capability.renderer} protocol=${capability.protocol} reason=${capability.reason}`,
  );

  try {
    const cachedPath = await getCachedPoster(posterPath);
    if (!cachedPath) return;

    try {
      await renderPosterFile(cachedPath, capability, resolvedOptions);
    } catch (error) {
      if (error instanceof NonPngError) {
        debugImage("kitty-native skipped: non-PNG input");
        if (capability.renderer === "kitty-native" && Bun.which("chafa")) {
          try {
            await renderChafaKitty(cachedPath, resolvedOptions);
          } catch (fallbackError) {
            debugImage(
              `chafa kitty fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
            );
          }
        }
        return;
      }
      debugImage(
        `poster rendering failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } catch (error) {
    debugImage(
      `poster rendering crashed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export { detectImageCapability, detectTerminal, isKittyCompatible } from "./capability";
export type {
  ImageCapability,
  ImageProtocol,
  ImageRenderOptions,
  ImageRendererId,
  TerminalId,
} from "./types";
