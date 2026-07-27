import type { ImageCapability, ImageRenderOptions } from "../types";
import { renderChafaSymbols } from "./chafa";
import { renderHalfBlock } from "./half-block";
import { renderKittyNative } from "./kitty";
import { renderNoop } from "./noop";
import { renderSixel } from "./sixel";

export async function renderPosterFile(
  filePath: string,
  capability: ImageCapability,
  options: ImageRenderOptions,
): Promise<void> {
  switch (capability.renderer) {
    case "kitty-native":
      return renderKittyNative(filePath, options);
    case "sixel":
      return renderSixel(filePath, options);
    case "chafa-symbols":
      return renderChafaSymbols(filePath, options);
    case "half-block":
      return renderHalfBlock(filePath, options);
    case "none":
      return renderNoop();
  }
}

export { renderChafaKitty } from "./chafa";
export { renderHalfBlock } from "./half-block";
export { renderKittyNative, NonPngError } from "./kitty";
