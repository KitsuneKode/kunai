import { codeMetadata } from "./code-metadata";
import { homeSectionsFromNav } from "./doc-navigation";

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

export type HomeProof = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
};

export const homeHero = {
  eyebrow: "Kunai CLI",
  title: "A calm command shell for playable streams.",
  description:
    "Search, resolve a direct provider stream, hand it to mpv, and recover from provider churn without losing your place. Local decryption, no browser required.",
  installCommands: ["bun install -g @kitsunekode/kunai", "kunai --setup"],
  primaryCta: {
    label: "Read the docs",
    href: "/docs",
  },
  secondaryCta: {
    label: "See recovery",
    href: "/docs/users/playback-and-recovery",
  },
} as const;

const providerCount = codeMetadata.providerIds.length;

export const homeHighlights = [
  {
    label: "Provider truth",
    detail: `${providerCount} active provider modules resolved locally. No cloud proxies, no Playwright.`,
  },
  {
    label: "Fast return loop",
    detail:
      "Continue Watching, history, calendar, and recommendations stay reachable after playback ends.",
  },
  {
    label: "Recoverable playback",
    detail: "Restart, recover, recompute, and fallback each handle a distinct failure mode.",
  },
] as const;

export const homeFlow: readonly HomeFlowStep[] = [
  {
    title: "Search or continue",
    description:
      "Search by title, continue the newest unfinished history entry, or pick from calendar, recommendations, or offline library.",
    state: "focus",
  },
  {
    title: "Resolve with evidence",
    description:
      "Kunai checks provider health, resolves streams through direct HTTP (no browser), validates the manifest, and keeps source inventory in SQLite.",
    state: "warn",
  },
  {
    title: "Hand off to mpv",
    description:
      "The shell launches mpv, supervises position reporting, applies autoskip timing, and monitors for bootstrap stalls or playback death.",
    state: "ready",
  },
  {
    title: "Recover without guessing",
    description:
      "When streams stall or providers drift: recover refreshes the current provider, recompute bypasses all caches, fallback tries the next provider in the priority chain.",
    state: "danger",
  },
  {
    title: "Return to the next beat",
    description:
      "Post-playback surfaces auto-advance, playlist queue, recommendations, and history — always one action from the next watch.",
    state: "quiet",
  },
] as const;

export const homeProof: readonly HomeProof[] = [
  {
    label: "Playback contract",
    value: "mpv first",
    detail:
      "Kunai resolves streams and supervises state; mpv remains the playback engine. No custom media pipeline.",
  },
  {
    label: "Diagnostics posture",
    value: "redacted",
    detail:
      "Support bundles exclude stream URLs, subtitle URLs, auth tokens, and home paths. Privacy-first by default.",
  },
  {
    label: "Runtime model",
    value: "Bun CLI",
    detail:
      "Terminal-first shell with codegen-synced command and provider counts. Predictable daily use.",
  },
] as const;

export const homeSections = homeSectionsFromNav();
