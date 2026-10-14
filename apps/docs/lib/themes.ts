/**
 * Kanna's coats — the accent themes the site can wear.
 *
 * Every coat swaps the accent family only: background, surfaces, lines and the
 * status palette stay put, because the whole token set was tuned for contrast
 * around a light accent on the Ember Dusk ground. A coat is therefore four
 * hexes, and every one of them must stay light enough to keep primary text and
 * controls legible against `#100b0f`.
 *
 * The same values are mirrored in `app/styles/tokens.css` under
 * `html[data-theme="…"]` — CSS cannot import this file, and JS cannot read
 * pending computed custom properties mid-transition, so both sides keep the
 * hexes. `test/theme.test.ts` pins them equal.
 */
/** How a coat enters the page when the cycler picks it — the skiper26 variants,
 *  one per coat so cycling is a discovery sequence rather than the same wipe
 *  five times. */
export type ThemeReveal = "circle" | "circle-blur" | "rise" | "diagonal" | "unfold";

export type KunaiTheme = {
  readonly id: string;
  readonly label: string;
  readonly accent: string;
  readonly deep: string;
  readonly soft: string;
  readonly reveal: ThemeReveal;
};

/** The default coat. It is what `:root` already paints, so activating it
 *  removes `data-theme` rather than setting it. */
export const DEFAULT_THEME_ID = "sakura";

export const kunaiThemes: readonly [KunaiTheme, ...KunaiTheme[]] = [
  {
    id: "sakura",
    label: "Sakura",
    accent: "#ff8fb0",
    deep: "#d85f86",
    soft: "#ffc6d8",
    reveal: "circle",
  },
  {
    id: "matcha",
    label: "Matcha",
    accent: "#a3d9a5",
    deep: "#72b27a",
    soft: "#d6efdb",
    reveal: "rise",
  },
  {
    id: "indigo",
    label: "Indigo",
    accent: "#a9b8f5",
    deep: "#8293e0",
    soft: "#d8e0fb",
    reveal: "diagonal",
  },
  {
    id: "ember",
    label: "Ember",
    accent: "#f2b268",
    deep: "#d18a45",
    soft: "#f8d8ad",
    reveal: "circle-blur",
  },
  {
    id: "violet",
    label: "Violet",
    accent: "#c9a6f2",
    deep: "#a57fd4",
    soft: "#e3d2f9",
    reveal: "unfold",
  },
] as const;

export const THEME_STORAGE_KEY = "kunai-theme";

export function isKunaiThemeId(value: string | null | undefined): value is string {
  return kunaiThemes.some((theme) => theme.id === value);
}

/**
 * The pre-paint snippet inlined into `<head>`: applies a stored coat before the
 * first frame so the accent never flashes Sakura-then-something-else. Unknown
 * values are dropped; the default coat removes the attribute rather than
 * writing a redundant one.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t&&${JSON.stringify(kunaiThemes.map((theme) => theme.id))}.indexOf(t)>-1){if(t===${JSON.stringify(DEFAULT_THEME_ID)}){delete document.documentElement.dataset.theme}else{document.documentElement.dataset.theme=t}}}catch(e){}})();`;
