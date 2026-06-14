export type DocHubCard = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

export type DocHubGroup = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly DocHubCard[];
};

export const docsRootCards: readonly DocHubCard[] = [
  {
    title: "User guides",
    href: "/docs/users",
    description:
      "Install Kunai, learn the shell, recover playback, manage offline media, and read privacy boundaries.",
  },
  {
    title: "Developer",
    href: "/docs/developer",
    description:
      "Debug sessions with evidence, run live smokes safely, and maintain codegen-synced documentation.",
  },
  {
    title: "CLI reference",
    href: "/docs/users/cli-reference",
    description: "Launch flags, provider registry, and command tables synced from the running CLI.",
  },
  {
    title: "Getting started",
    href: "/docs/users/getting-started",
    description: "The fastest honest path from zero to a first successful playback session.",
  },
] as const;

export const userGuideGroups: readonly DocHubGroup[] = [
  {
    id: "setup",
    eyebrow: "First run",
    title: "Set up Kunai",
    description:
      "Install once, verify Bun and mpv, then learn the launch flags that actually change bootstrap behavior.",
    items: [
      {
        title: "Getting Started",
        href: "/docs/users/getting-started",
        description:
          "Install, run setup, and complete a first session with explicit recovery steps.",
      },
      {
        title: "Install And Update",
        href: "/docs/users/install-and-update",
        description: "Global package, source checkout, installer script, and manual update checks.",
      },
      {
        title: "Platforms",
        href: "/docs/users/platforms",
        description:
          "Linux, macOS, Windows, and source-checkout notes with optional tool guidance.",
      },
      {
        title: "CLI Reference",
        href: "/docs/users/cli-reference",
        description: "Codegen-synced flags, providers, and launch flows from `kunai --help`.",
      },
    ],
  },
  {
    id: "daily",
    eyebrow: "Daily use",
    title: "Watch and navigate",
    description:
      "How search, shell commands, playback handoff, and continuation fit together in one session.",
    items: [
      {
        title: "Feature Tour",
        href: "/docs/users/feature-tour",
        description: "Capability map with live command and provider tables from the registry.",
      },
      {
        title: "Commands And Shortcuts",
        href: "/docs/users/commands-and-shortcuts",
        description: "Palette commands, playback actions, overlays, and reporting shortcuts.",
      },
      {
        title: "Playback And Recovery",
        href: "/docs/users/playback-and-recovery",
        description: "Recover, replay, resume, fallback, and what each action actually does.",
      },
      {
        title: "Continue Watching",
        href: "/docs/users/continue-watching-and-new-episodes",
        description: "History continuation, auto-advance, and queue behavior after playback.",
      },
      {
        title: "Media Selection",
        href: "/docs/users/media-selection",
        description: "Seasons, episodes, subtitles, qualities, and provider picking in the shell.",
      },
      {
        title: "Runtime Feedback",
        href: "/docs/users/runtime-feedback",
        description: "Loading states, toasts, overlays, and how Kunai explains slow paths.",
      },
    ],
  },
  {
    id: "offline",
    eyebrow: "Local media",
    title: "Downloads and offline",
    description:
      "Separate download-only launch from in-shell queue management — they are not the same entry point.",
    items: [
      {
        title: "Downloads And Offline",
        href: "/docs/users/downloads-and-offline",
        description:
          "Queue jobs, validate artifacts, and play completed downloads without provider calls.",
      },
    ],
  },
  {
    id: "trust",
    eyebrow: "Trust",
    title: "Reliability and privacy",
    description:
      "What Kunai stores locally, what stays in cache, and what never belongs in a support bundle.",
    items: [
      {
        title: "Reliability And Privacy",
        href: "/docs/users/reliability-and-privacy",
        description: "Durable vs disposable data, redacted diagnostics, and recovery posture.",
      },
      {
        title: "Diagnostics And Reporting",
        href: "/docs/users/diagnostics-and-reporting",
        description: "Inspect runtime state, export bundles, and file issues without leaking URLs.",
      },
    ],
  },
] as const;

export const developerGuideGroups: readonly DocHubGroup[] = [
  {
    id: "develop",
    eyebrow: "Contributors",
    title: "Work on Kunai safely",
    description:
      "Evidence-first debugging, explicit live-provider checks, and docs that stay synced with the CLI.",
    items: [
      {
        title: "Debugging Workflow",
        href: "/docs/developer/debugging-workflow",
        description:
          "Triage playback failures, read traces, and run manual live smokes responsibly.",
      },
      {
        title: "Docs Maintenance",
        href: "/docs/developer/docs-maintenance",
        description:
          "Add pages, run drift tests, and ship documentation without coupling CLI releases.",
      },
    ],
  },
] as const;

export type DocHubGroupId =
  | (typeof userGuideGroups)[number]["id"]
  | (typeof developerGuideGroups)[number]["id"];

export function getDocHubGroup(id: DocHubGroupId): DocHubGroup | undefined {
  return [...userGuideGroups, ...developerGuideGroups].find((group) => group.id === id);
}
