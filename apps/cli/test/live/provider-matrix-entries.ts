/**
 * The provider matrix roster, kept in a side-effect-free module so a unit test
 * can assert it still covers every registered production provider — a smoke
 * file cannot be imported without running the matrix itself.
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
    provider: "videasy",
    command: ["bun", "test/live/videasy-bloodhounds.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "videasy"],
    media: "series",
    fixture: "Dutton Ranch S01E01 (Neon Phase A)",
  },
  {
    provider: "rivestream",
    command: ["bun", "-e", "await import('./test/live/rivestream-breakingbad.smoke.ts')"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "rivestream"],
    media: "series",
    fixture: "Breaking Bad S01E01",
  },
  {
    provider: "vidlink",
    command: ["bun", "test/live/vidlink-inception.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "vidlink"],
    media: "movie",
    fixture: "Inception (DASH + playlist cookie)",
  },
  {
    provider: "movy",
    command: ["bun", "test/live/movy-inception.smoke.ts"],
    media: "movie",
    fixture: "Inception (multi-lane aggregator)",
  },
  {
    provider: "vidrock",
    command: ["bun", "test/live/vidrock-inception.smoke.ts"],
    media: "movie",
    fixture: "Inception (AES-GCM lanes + space UA)",
  },
  {
    provider: "hianime",
    command: ["bun", "test/live/hianime-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto S01E01 (sub + dub legs)",
  },
  {
    provider: "kickassanime",
    command: ["bun", "test/live/kickassanime-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto S01E01 sub (provider-native search)",
  },
  {
    provider: "animegg",
    command: ["bun", "test/live/animegg-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto S01E01 sub (mpv decode evidence)",
  },
  {
    provider: "anidb",
    command: ["bun", "-e", "await import('./test/live/anidb-onigiri.smoke.ts')"],
    media: "anime",
    fixture: "Onigiri S01E01",
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
