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
    "Find a title, resolve a direct provider stream, hand it to mpv, and recover from provider churn without losing your place.",
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
    detail: "Aired, available, cached, and offline states stay separate.",
  },
  {
    label: "Fast return loop",
    detail:
      "Continue watching, calendar, history, and post-playback point back to the next safe action.",
  },
  {
    label: "Recoverable playback",
    detail: "Recover, replay, refresh source, and fallback mean different things.",
  },
] as const;

export const homeFlow: readonly HomeFlowStep[] = [
  {
    title: "Search or continue",
    description:
      "Start from a query, a remembered title, a calendar release, or an offline-ready file.",
    state: "focus",
  },
  {
    title: "Resolve with evidence",
    description:
      "Kunai checks provider reality before promising playback, then keeps source and subtitle state visible.",
    state: "warn",
  },
  {
    title: "Hand off to mpv",
    description:
      "The shell supervises launch, position, autoskip, autoplay, and recovery while mpv does the playing.",
    state: "ready",
  },
  {
    title: "Recover without guessing",
    description:
      "When streams stall or providers drift, Kunai explains the failure and offers the next repair path.",
    state: "danger",
  },
  {
    title: "Return to the next beat",
    description:
      "Post-playback, history, and calendar keep one primary action in front of the user.",
    state: "quiet",
  },
] as const;

export const homeProof: readonly HomeProof[] = [
  {
    label: "Playback contract",
    value: "mpv first",
    detail: "Kunai resolves streams and supervises state; mpv remains the playback engine.",
  },
  {
    label: "Diagnostics posture",
    value: "redacted",
    detail: "Support bundles exclude stream URLs, subtitle URLs, headers, tokens, and local paths.",
  },
  {
    label: "Runtime model",
    value: "Bun CLI",
    detail:
      "The shipped experience is terminal-first, predictable, and designed for repeat daily use.",
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
