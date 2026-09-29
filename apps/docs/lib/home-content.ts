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
 * The four catalog modes, in the order `Tab` cycles them in the shell.
 *
 * These live in the server-rendered hero on purpose. The terminal simulator is
 * the only other place on this page that names what Kunai plays, and it is
 * loaded with `ssr: false` after an interaction — so before this row existed,
 * neither a crawler nor a visitor skimming for two seconds could learn that
 * Kunai plays anime at all.
 */
export const homeKinds = ["Anime", "Series", "Movies", "YouTube"] as const;

export const homeHero = {
  title: "Watch anime, series and movies from your terminal.",
  description:
    "Kunai searches a title, resolves a stream a direct provider already serves, and hands playback to mpv — with YouTube, downloads, resume, and recovery in the same keyboard-driven session.",
  kinds: homeKinds,
  /** Earns its place by teaching a real hotkey rather than labelling the row. */
  kindsHint: { key: "Tab", label: "cycles modes" },
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
    label: "Four catalog modes",
    detail:
      "Series, anime, and YouTube each get their own mode. Tab cycles them; /anime, /series, and /youtube jump straight to one.",
  },
  {
    label: "Direct providers",
    detail: `${providerCount} provider modules resolve streams on your machine. No browser automation and no shared relay by default.`,
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
      "Find an episode, a film, or a YouTube video — or resume history, open the release calendar, and browse your offline library from the shell.",
  },
  {
    title: "Resolve locally",
    description:
      "Kunai asks registered adapters for a stream URL they already serve, then hands that URL to mpv.",
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
