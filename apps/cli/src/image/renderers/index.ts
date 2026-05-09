import type { ImageCapability, ImageRenderOptions } from "../types";
import { renderChafaSixels, renderChafaSymbols } from "./chafa";
import { renderKittyNative } from "./kitty";
import { renderNoop } from "./noop";

export async function renderPosterFile(
  filePath: string,
  capability: ImageCapability,
  options: ImageRenderOptions,
): Promise<void> {
  switch (capability.renderer) {
    case "kitty-native":
      return renderKittyNative(filePath, options);
    case "chafa-sixel":
      return renderChafaSixels(filePath, options);
    case "chafa-symbols":
      return renderChafaSymbols(filePath, options);
    case "none":
      return renderNoop();
  }
}

export { renderChafaKitty } from "./chafa";
export { renderKittyNative, NonPngError } from "./kitty";
