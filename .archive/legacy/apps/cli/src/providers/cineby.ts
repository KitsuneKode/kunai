import type { PlaywrightProvider } from "./types";

// Cineby uses a lazy player that only starts on user interaction.
// A simulated click at (500, 500) after DOM load wakes it up.
// The OG meta title is the most reliable title source for Cineby.

export const Cineby: PlaywrightProvider = {
  kind: "playwright",
  id: "cineby",
  name: "Cineby",
  description: "Cineby",
  domain: "cineby.sc",
  recommended: false,

  movieUrl: (id) => `https://www.cineby.sc/movie/${id}?play=true`,
  seriesUrl: (id, s, e) => `https://www.cineby.sc/tv/${id}/${s}/${e}?play=true`,

  needsClick: true,
  titleSource: "og",
};
