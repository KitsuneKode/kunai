/**
 * Single source of truth for documentation navigation cards.
 * Consumed by doc-hub.ts, home-content.ts, and drift tests.
 */

export type DocNavGroup =
  | "setup"
  | "daily"
  | "offline"
  | "trust"
  | "develop"
  | "reference"
  | "overview";

export type DocNavSurface = "home" | "hub" | "sidebar";

export type DocNavEntry = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
  readonly group: DocNavGroup;
  readonly surfaces?: readonly DocNavSurface[];
};

export const docNavEntries: readonly DocNavEntry[] = [
  // Root hub cards
  {
    title: "User guides",
    href: "/docs/users",
    description:
      "Install Kunai, learn the shell, recover playback, manage offline media, and read privacy boundaries.",
    group: "overview",
    surfaces: ["hub"],
  },
  {
    title: "Developer",
    href: "/docs/developer",
    description:
      "Debug sessions with evidence, run live smokes safely, and keep documentation aligned with the CLI.",
    group: "overview",
    surfaces: ["hub"],
  },
  {
    title: "CLI reference",
    href: "/docs/users/cli-reference",
    description: "Launch flags, provider registry, and command tables synced from the running CLI.",
    group: "reference",
    surfaces: ["hub", "home"],
  },
  {
    title: "Getting started",
    href: "/docs/users/getting-started",
    description: "The fastest honest path from zero to a first successful playback session.",
    group: "setup",
    surfaces: ["hub", "home"],
  },
  {
    title: "What you can do",
    href: "/docs/users/what-you-can-do",
    description:
      "Concrete scenarios: search, play, recover, continue, discover, and export diagnostics.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  // Setup
  {
    title: "Install And Update",
    href: "/docs/users/install-and-update",
    description: "Global package, source checkout, installer script, and manual update checks.",
    group: "setup",
    surfaces: ["hub"],
  },
  {
    title: "Platforms",
    href: "/docs/users/platforms",
    description: "Linux, macOS, Windows, and source-checkout notes with optional tool guidance.",
    group: "setup",
    surfaces: ["hub", "home"],
  },
  {
    title: "Customization",
    href: "/docs/users/customization",
    description: "Config, provider overrides, mpv forwarding, themes, and presence setup.",
    group: "setup",
    surfaces: ["hub"],
  },
  {
    title: "Supported And Unsupported",
    href: "/docs/users/supported-and-unsupported",
    description: "What Kunai ships today, what is beta-only, and what is explicitly out of scope.",
    group: "setup",
    surfaces: ["hub"],
  },
  // Daily
  {
    title: "Share Links",
    href: "/docs/users/share-links",
    description: "Copy and open catalog-anchored kunai:// links across machines and providers.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Feature Tour",
    href: "/docs/users/feature-tour",
    description: "Capability map with live command and provider tables from the registry.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Commands And Shortcuts",
    href: "/docs/users/commands-and-shortcuts",
    description: "Palette commands, playback actions, overlays, and reporting shortcuts.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Playback And Recovery",
    href: "/docs/users/playback-and-recovery",
    description: "Recover, replay, resume, fallback, and what each action actually does.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Continue Watching",
    href: "/docs/users/continue-watching-and-new-episodes",
    description: "History continuation, auto-advance, and queue behavior after playback.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Media Selection",
    href: "/docs/users/media-selection",
    description: "Seasons, episodes, subtitles, qualities, and provider picking in the shell.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Runtime Feedback",
    href: "/docs/users/runtime-feedback",
    description: "Loading states, toasts, overlays, and how Kunai explains slow paths.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  {
    title: "Providers",
    href: "/docs/users/providers",
    description:
      "How provider fallback works, what retry means, and what Kunai does not guarantee.",
    group: "daily",
    surfaces: ["hub"],
  },
  {
    title: "Troubleshooting",
    href: "/docs/users/troubleshooting",
    description: "Symptom-indexed fixes with evidence to collect before filing an issue.",
    group: "daily",
    surfaces: ["hub", "home"],
  },
  // Offline
  {
    title: "Downloads And Offline",
    href: "/docs/users/downloads-and-offline",
    description:
      "Queue jobs, validate artifacts, and play completed downloads without provider calls.",
    group: "offline",
    surfaces: ["hub", "home"],
  },
  // Trust
  {
    title: "Reliability And Privacy",
    href: "/docs/users/reliability-and-privacy",
    description: "Durable vs disposable data, redacted diagnostics, and recovery posture.",
    group: "trust",
    surfaces: ["hub", "home"],
  },
  {
    title: "Diagnostics And Reporting",
    href: "/docs/users/diagnostics-and-reporting",
    description: "Inspect runtime state, export bundles, and file issues without leaking URLs.",
    group: "trust",
    surfaces: ["hub", "home"],
  },
  // Developer
  {
    title: "Debugging Workflow",
    href: "/docs/developer/debugging-workflow",
    description: "Triage playback failures, read traces, and run manual live smokes responsibly.",
    group: "develop",
    surfaces: ["hub", "home"],
  },
  {
    title: "Contribute",
    href: "/docs/developer/contribute",
    description: "Fork, test, open PRs, and run live provider checks only when appropriate.",
    group: "develop",
    surfaces: ["hub"],
  },
  {
    title: "Docs Maintenance",
    href: "/docs/developer/docs-maintenance",
    description:
      "Add pages, run drift tests, and ship documentation without coupling CLI releases.",
    group: "develop",
    surfaces: ["hub", "home"],
  },
  {
    title: "Release Checklist",
    href: "/docs/developer/release-checklist",
    description: "Regenerate codegen metadata and verify the docs gate on each CLI release.",
    group: "develop",
    surfaces: ["hub"],
  },
  {
    title: "Glossary",
    href: "/docs/users/glossary",
    description: "Commands, CLI flags, and feature terms synced from codegen metadata.",
    group: "reference",
    surfaces: ["hub"],
  },
  {
    title: "Changelog",
    href: "/releases",
    description: "Release notes generated from the same artifact used for GitHub releases.",
    group: "reference",
    surfaces: ["hub", "sidebar"],
  },
] as const;

export type HomeSectionConfig = {
  readonly title: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly group: DocNavGroup;
};

export const homeSectionConfigs: readonly HomeSectionConfig[] = [
  {
    title: "Set up",
    eyebrow: "First run",
    description: "Install once, check runtime dependencies, then launch playback with guardrails.",
    group: "setup",
  },
  {
    title: "Watch",
    eyebrow: "Daily use",
    description:
      "Understand how playback, recovery, local downloads, and continuation fit together.",
    group: "daily",
  },
  {
    title: "Understand",
    eyebrow: "Know what is happening",
    description:
      "Read the shell signals that explain slow providers, buffering, Discord presence, and memory.",
    group: "trust",
  },
  {
    title: "Build",
    eyebrow: "For contributors",
    description:
      "Keep features documented, tested, and straightforward for contributors to extend.",
    group: "develop",
  },
] as const;

export function entriesForGroup(group: DocNavGroup): readonly DocNavEntry[] {
  return docNavEntries.filter((entry) => entry.group === group);
}

export function entriesForSurface(surface: DocNavSurface): readonly DocNavEntry[] {
  return docNavEntries.filter((entry) => entry.surfaces?.includes(surface));
}

export function hubRootCards(): readonly DocNavEntry[] {
  const rootHrefs = [
    "/docs/users",
    "/docs/developer",
    "/docs/users/cli-reference",
    "/docs/users/getting-started",
  ] as const;
  return docNavEntries.filter((entry) =>
    rootHrefs.includes(entry.href as (typeof rootHrefs)[number]),
  );
}

export function hubGroups(): readonly {
  id: DocNavGroup;
  eyebrow: string;
  title: string;
  description: string;
  items: readonly DocNavEntry[];
}[] {
  const groups: {
    id: DocNavGroup;
    eyebrow: string;
    title: string;
    description: string;
    items: DocNavEntry[];
  }[] = [
    {
      id: "setup",
      eyebrow: "First run",
      title: "Set up Kunai",
      description:
        "Install once, verify Bun and mpv, then learn the launch flags that actually change bootstrap behavior.",
      items: [],
    },
    {
      id: "daily",
      eyebrow: "Daily use",
      title: "Watch and navigate",
      description:
        "How search, shell commands, playback handoff, and continuation fit together in one session.",
      items: [],
    },
    {
      id: "offline",
      eyebrow: "Local media",
      title: "Downloads and offline",
      description:
        "Separate download-only launch from in-shell queue management — they are not the same entry point.",
      items: [],
    },
    {
      id: "trust",
      eyebrow: "Trust",
      title: "Reliability and privacy",
      description:
        "What Kunai stores locally, what stays in cache, and what never belongs in a support bundle.",
      items: [],
    },
    {
      id: "develop",
      eyebrow: "Contributors",
      title: "Work on Kunai safely",
      description:
        "Evidence-first debugging, explicit live-provider checks, and docs that stay synced with the CLI.",
      items: [],
    },
  ];

  for (const group of groups) {
    group.items = docNavEntries.filter((entry) => entry.group === group.id);
  }

  return groups;
}

export function homeSectionsFromNav(): readonly {
  title: string;
  eyebrow: string;
  description: string;
  items: readonly { title: string; href: string; description: string }[];
}[] {
  return homeSectionConfigs.map((section) => ({
    title: section.title,
    eyebrow: section.eyebrow,
    description: section.description,
    items: entriesForGroup(section.group)
      .filter((entry) => entry.surfaces?.includes("home"))
      .map(({ title, href, description }) => ({ title, href, description })),
  }));
}
