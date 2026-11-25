// Measured color contrast helpers — WCAG 2.1 relative luminance ratio and
// APCA 0.0.98G-4g lightness contrast (Lc). Used to verify every palette's text,
// semantic status, and control-edge tokens against the surfaces they paint on.

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new RangeError(`Expected 6-digit hex color, received "${hex}"`);
  }
  const n = Number.parseInt(normalized, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const linear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio in [1, 21] for two sRGB `#rrggbb` hex colors. */
export function wcagContrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function apcaLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const y =
    0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
}

/**
 * APCA 0.0.98G-4g signed lightness contrast (`Lc`), positive for dark text on a
 * light surface and negative for light text on a dark surface. Compare with
 * `Math.abs(apcaContrastLc(text, bg))`.
 */
export function apcaContrastLc(text: string, background: string): number {
  const yText = apcaLuminance(text);
  const yBg = apcaLuminance(background);
  if (Math.abs(yBg - yText) < 0.0005) return 0;
  if (yBg > yText) {
    const sapc = (yBg ** 0.56 - yText ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yBg ** 0.65 - yText ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}
