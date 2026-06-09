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
    "Search, resolve a direct provider stream, hand it to mpv, and recover from provider churn without losing your place. Five active providers, local decryption, no browser required.",
  installCommands: ["bun install -g @kitsunekode/kunai", "kunai --setup"],
  primaryCta: {
    label: "Read the guide",
    href: "/docs/users/getting-started",
  },
  secondaryCta: {
    label: "See recovery",
    href: "/docs/users/playback-and-recovery",
  },
} as const;

export const homeHighlights = [
  {
    label: "Provider truth",
    detail: "5 active provider modules resolved locally. No cloud proxies, no Playwright.",
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
      "Terminal-first. 66 shell commands across 3 context groups. 5 provider modules. 1 SQLite history DB. Predictable daily use.",
  },
] as const;

export const homeSections: readonly HomeSection[] = [
  {
    title: "Set up",
    eyebrow: "First run",
    description: "Install once, check runtime dependencies, then launch playback with guardrails.",
    items: [
      {
        title: "Getting Started",
        href: "/docs/users/getting-started",
        description: "Install Kunai, check dependencies, and start playback safely.",
      },
      {
        title: "Platforms",
        href: "/docs/users/platforms",
        description: "Linux, macOS, Windows, source checkout, and optional tool notes.",
      },
      {
        title: "Commands And Shortcuts",
        href: "/docs/users/commands-and-shortcuts",
        description: "Palette commands, playback actions, overlays, and reporting shortcuts.",
      },
      {
        title: "Feature Tour",
        href: "/docs/users/feature-tour",
        description: "A compact map of the terminal-first playback experience.",
      },
    ],
  },
  {
    title: "Watch",
    eyebrow: "Daily use",
    description:
      "Understand how playback, recovery, local downloads, and continuation fit together.",
    items: [
      {
        title: "Playback And Recovery",
        href: "/docs/users/playback-and-recovery",
        description: "Recover, replay, resume, fallback, and playback guardrails.",
      },
      {
        title: "Downloads And Offline",
        href: "/docs/users/downloads-and-offline",
        description: "Offline playback without mixing cache facts into user data.",
      },
      {
        title: "Media Selection",
        href: "/docs/users/media-selection",
        description: "Sources, streams, audio, subtitles, quality, and when pickers appear.",
      },
      {
        title: "Continue Watching And New Episodes",
        href: "/docs/users/continue-watching-and-new-episodes",
        description: "History reconciliation, release signals, and continuation shelves.",
      },
    ],
  },
  {
    title: "Understand",
    eyebrow: "Know what is happening",
    description:
      "Read the shell signals that explain slow providers, buffering, Discord presence, and memory.",
    items: [
      {
        title: "Runtime Feedback",
        href: "/docs/users/runtime-feedback",
        description:
          "Playback memory, network health, app/mpv RSS, and when to export diagnostics.",
      },
      {
        title: "Diagnostics And Reporting",
        href: "/docs/users/diagnostics-and-reporting",
        description: "Debug context that stays useful and privacy-safe.",
      },
      {
        title: "Reliability And Privacy",
        href: "/docs/users/reliability-and-privacy",
        description: "Release gates, storage boundaries, and safe support bundles.",
      },
    ],
  },
  {
    title: "Build",
    eyebrow: "For contributors",
    description: "Keep features documented, tested, and easy for future agents to extend.",
    items: [
      {
        title: "Debugging Workflow",
        href: "/docs/developer/debugging-workflow",
        description: "Trace playback, providers, diagnostics, storage, and release issues.",
      },
      {
        title: "Docs Maintenance",
        href: "/docs/developer/docs-maintenance",
        description: "Add pages, keep docs maintainable, and preserve Turbo build boundaries.",
      },
    ],
  },
];
