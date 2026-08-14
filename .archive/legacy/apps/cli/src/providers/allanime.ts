import { createAllAnimeApiProvider } from "./allanime-api-client";

// AllAnime / AllManga — the reference implementation for this specific API family.
// To add a compatible provider, call createAllAnimeApiProvider with different config.

export const AllAnime = createAllAnimeApiProvider({
  id: "allanime",
  name: "AllAnime",
  description: "AllAnime / AllManga  (anime · sub & dub · no browser needed)",
  domain: "allanime.day",
  apiUrl: "https://api.allanime.day/api",
  referer: "https://youtu-chan.com",
  recommended: false,
  isAnimeProvider: true,
});
