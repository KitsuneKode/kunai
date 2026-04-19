import type { Provider } from "./types";

// URL params:
//   autoPlay=true         → player fires on load, no mouse click needed
//   episodeSelector=false → hides built-in episode picker
//   nextEpisode=false     → hides the overlay "next episode" button

export const VidKing: Provider = {
  id:          "vidking",
  name:        "VidKing",
  description: "VidKing  (recommended)",
  domain:      "vidking.net",
  recommended: true,

  movieUrl:  (id) =>
    `https://www.vidking.net/embed/movie/${id}?autoPlay=true`,

  seriesUrl: (id, s, e) =>
    `https://www.vidking.net/embed/tv/${id}/${s}/${e}?autoPlay=true&episodeSelector=false&nextEpisode=false`,

  needsClick: false, // autoPlay=true handles it

  titleSource:    "selectors",
  titleSelectors: ["h1", "h2", "[class*='title']", "[class*='name']"],
};
