/**
 * Production providers the live matrix must run.
 *
 * Kept out of `provider-matrix.smoke.ts` so a unit test can pin this list to
 * `loadProductionProviderModules()` without starting a network smoke. Order
 * follows the shipped lanes: series fallback, then anime fallback, then YouTube.
 */
export type MatrixEntry = {
  readonly provider: string;
  readonly command: readonly string[];
  readonly media: string;
  readonly fixture: string;
  /**
   * Command that also decodes frames in mpv. Its payload is a superset of the
   * normal smoke's, so playback mode simply swaps the command.
   */
  readonly playbackCommand?: readonly string[];
};

export const MATRIX: readonly MatrixEntry[] = [
  {
    provider: "vidlink",
    command: ["bun", "test/live/vidlink-inception.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "vidlink"],
    media: "movie",
    fixture: "Inception (DASH + playlist cookie)",
  },
  {
    provider: "rivestream",
    command: ["bun", "-e", "await import('./test/live/rivestream-breakingbad.smoke.ts')"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "rivestream"],
    media: "series",
    fixture: "Breaking Bad S01E01",
  },
  {
    provider: "vidrock",
    command: ["bun", "test/live/mpv-playback.smoke.ts", "vidrock"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "vidrock"],
    media: "movie",
    fixture: "Fight Club (Chrome UA + Referer/Origin)",
  },
  {
    provider: "movy",
    command: ["bun", "test/live/movy-inception.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "movy"],
    media: "movie",
    fixture: "Inception",
  },
  {
    provider: "videasy",
    command: ["bun", "test/live/videasy-bloodhounds.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "videasy"],
    media: "series",
    fixture: "Dutton Ranch S01E01 (Neon Phase A)",
  },
  {
    provider: "hianime",
    command: ["bun", "test/live/hianime-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto E1",
  },
  {
    provider: "kickassanime",
    command: ["bun", "test/live/kickassanime-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto E1",
  },
  {
    provider: "animegg",
    command: ["bun", "test/live/animegg-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto E1",
  },
  {
    provider: "allanime",
    command: ["bun", "-e", "await import('./test/live/allanime-demonslayer.smoke.ts')"],
    media: "anime",
    fixture: "Kimetsu no Yaiba S01E01",
  },
  {
    provider: "miruro",
    command: ["bun", "-e", "await import('./test/live/miruro-demonslayer.smoke.ts')"],
    media: "anime",
    fixture: "One Piece E1159",
  },
  {
    provider: "youtube",
    command: ["bun", "-e", "await import('./test/live/youtube.smoke.ts')"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "youtube"],
    media: "youtube",
    fixture: "Me at the zoo (jNQXAC9IVRw)",
  },
];
