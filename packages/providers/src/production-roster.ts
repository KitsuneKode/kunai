/**
 * The production provider roster. The CLI loader and the relay registry both
 * read this list. `relay: false` keeps a provider off the metadata relay;
 * YouTube is the one that must stay off.
 */
export const productionProviderRoster = [
  { id: "videasy", relay: true },
  { id: "vidlink", relay: true },
  { id: "vidrock", relay: false },
  { id: "rivestream", relay: true },
  { id: "movy", relay: false },
  { id: "anidb", relay: true },
  { id: "allanime", relay: true },
  { id: "hianime", relay: false },
  { id: "miruro", relay: true },
  { id: "animegg", relay: false },
  { id: "kickassanime", relay: false },
  { id: "youtube", relay: false },
] as const;

export type ProductionProviderId = (typeof productionProviderRoster)[number]["id"];
