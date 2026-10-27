import { codeMetadata } from "./code-metadata";
import { CANONICAL_INSTALL, CANONICAL_SETUP } from "./install-commands";

export type HomeLink = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

export type HomeSection = {
  readonly title: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly items: readonly HomeLink[];
};

export type HomeFlowStep = {
  readonly title: string;
  readonly description: string;
};

/**
 * The four content types. Movies and series share one of three search modes.
 *
 * These live in the server-rendered hero on purpose. The terminal simulator is
 * the only other place on this page that names what Kunai plays, and it is
 * loaded with `ssr: false` after an interaction — so before this row existed,
 * neither a crawler nor a visitor skimming for two seconds could learn that
 * Kunai plays anime at all.
 */
export const homeKinds = ["Anime", "Series", "Movies", "YouTube"] as const;

export const homeHero = {
  title: "Watch anime, movies, series and YouTube from your terminal.",
  description:
    "Find a title, choose a source and play in mpv. Keep subtitles, resume, offline downloads and playback recovery together in one keyboard-driven session.",
  kinds: homeKinds,
  /** Earns its place by teaching a real hotkey rather than labelling the row. */
  kindsHint: { key: "Tab", label: "switches search mode" },
  installCommands: [CANONICAL_INSTALL, CANONICAL_SETUP],
  primaryCta: {
    label: "Get started",
    href: "/docs/users/getting-started",
  },
  secondaryCta: {
    label: "See what it can do",
    href: "/docs/users/what-you-can-do",
  },
} as const;

const providerCount = codeMetadata.providerIds.length;

export const homeHighlights = [
  {
    label: "Three search modes",
    detail:
      "Movies and TV series share series mode. Tab switches between series, anime and YouTube; /series, /anime and /youtube open one directly.",
  },
  {
    label: "Direct providers",
    detail: `${providerCount} provider modules resolve streams on your machine. Each source can offer different quality, audio and subtitle choices.`,
  },
  {
    label: "Continue watching",
    detail:
      "History, calendar, recommendations, and offline downloads stay one command away after playback ends.",
  },
  {
    label: "Recovery built in",
    detail:
      "Recover, recompute, and fallback each handle a different stall, with diagnostics that stay redacted by default.",
  },
] as const;

export const homeFlow: readonly HomeFlowStep[] = [
  {
    title: "Search or continue",
    description:
      "Find an episode, a film or a YouTube video, or pick up where you left off from history, the release calendar or your offline library.",
  },
  {
    title: "Resolve locally",
    description:
      "Kunai asks a provider for a stream it already serves and probes the candidate before handing its URL to mpv.",
  },
  {
    title: "Play in mpv",
    description:
      "The shell supervises playback, resume offers, auto-skip, and post-play routing when the session ends or stalls.",
  },
] as const;

export const homeStartCards: readonly HomeLink[] = [
  {
    title: "Getting started",
    href: "/docs/users/getting-started",
    description: "Install Kunai and mpv, run setup, and launch your first playback session.",
  },
  {
    title: "What you can do",
    href: "/docs/users/what-you-can-do",
    description: "See the daily shell workflows for search, playback, downloads, and recovery.",
  },
  {
    title: "Troubleshooting",
    href: "/docs/users/troubleshooting",
    description:
      "Fix stalled streams, provider failures, and setup issues with symptom-first steps.",
  },
  {
    title: "CLI reference",
    href: "/docs/users/cli-reference",
    description:
      "Browse the full command list, launch flags, and provider tables synced from the CLI.",
  },
] as const;
