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

export const homeHero = {
  eyebrow: "Kunai Docs",
  title: "Terminal streaming that stays explainable.",
  description:
    "Install Kunai, understand the playback feedback loop, and debug provider, mpv, memory, Discord, download, and history behavior without guessing.",
  installCommands: ["bun install -g @kitsunekode/kunai", "kunai --setup"],
  primaryCta: {
    label: "Start with the guide",
    href: "/docs/users/getting-started",
  },
  secondaryCta: {
    label: "Debug a session",
    href: "/docs/users/diagnostics-and-reporting",
  },
} as const;

export const homeHighlights = [
  {
    label: "Playback",
    detail: "mpv handoff, recovery, replay, fallback, stream selection",
  },
  {
    label: "Feedback",
    detail: "runtime health, memory, network, diagnostics, support bundles",
  },
  {
    label: "Library",
    detail: "continue watching, new episodes, downloads, queues, offline",
  },
] as const;

export const homeSections: readonly HomeSection[] = [
  {
    title: "Start",
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
    title: "Feedback",
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
    title: "Maintain",
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
