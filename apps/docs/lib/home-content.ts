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
  readonly state: "focus" | "ready" | "warn" | "danger" | "quiet";
};

export const homeHero = {
  eyebrow: "Terminal-first playback",
  title: "Kunai — a calm command shell for playable streams.",
  description:
    "Search your catalog, resolve a direct stream on your machine, hand playback to mpv, and recover without restarting when something stalls.",
  installCommands: [CANONICAL_INSTALL, CANONICAL_SETUP],
  primaryCta: {
    label: "Get started",
    href: "/docs/users/getting-started",
  },
  secondaryCta: {
    label: "Browse docs",
    href: "/docs",
  },
} as const;

const providerCount = codeMetadata.providerIds.length;

export const homeHighlights = [
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
      "Find a title, resume history, or open calendar, recommendations, or your offline library from the shell.",
    state: "focus",
  },
  {
    title: "Resolve locally",
    description:
      "Kunai checks provider health, resolves a direct stream, and keeps source inventory in SQLite before mpv starts.",
    state: "warn",
  },
  {
    title: "Play in mpv",
    description:
      "The shell supervises playback, resume offers, auto-skip, and post-play routing when the session ends or stalls.",
    state: "ready",
  },
] as const;

export const homeStartCards: readonly HomeLink[] = [
  {
    title: "Getting started",
    href: "/docs/users/getting-started",
    description: "Install Bun and mpv, run setup, and launch your first playback session.",
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
