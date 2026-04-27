import { createAnimeProvider } from "./allanime-family";

// AllAnime / AllManga — the reference implementation for this specific API family.
// To add a compatible provider, call createAnimeProvider with different config.

export const AllAnime = createAnimeProvider({
  id: "allanime",
  name: "AllAnime",
  description: "AllAnime / AllManga  (anime · sub & dub · no browser needed)",
  domain: "allanime.day",
  apiUrl: "https://api.allanime.day/api",
  referer: "https://youtu-chan.com",
  recommended: false,
  isAnimeProvider: true,
});
