import type { PlaywrightProvider } from "./types";

// BitCine is a Cineby clone — identical player behaviour, different domain.
// needsClick + og title strategy carry over exactly.

export const BitCine: PlaywrightProvider = {
  kind: "playwright",
  id: "bitcine",
  name: "BitCine",
  description: "BitCine  (Cineby mirror)",
  domain: "bitcine.net",
  recommended: false,

  movieUrl: (id) => `https://www.bitcine.net/movie/${id}?play=true`,
  seriesUrl: (id, s, e) => `https://www.bitcine.net/tv/${id}/${s}/${e}?play=true`,

  needsClick: true,
  titleSource: "og",
};
