/**
 * The other things KitsuneKode makes, shown in the footer and on the home page.
 *
 * Curated by hand, not read off the GitHub org: a profile fills up with forks,
 * experiments and coursework, and a showcase of "everything" says nothing about
 * what the maintainer stands behind. Every entry here is a maintained repository
 * (not a GitHub fork), checked against the API when added. Upstream credits,
 * including NvChad/base46's palettes, remain with each project.
 * `portless` is deliberately absent: it is a fork of an upstream project.
 *
 * Taglines are written here rather than pulled from each repo's description, so
 * the page never prints a truncated or stale blurb, but each one restates what
 * the repository itself says it does.
 */

const OWNER = "https://github.com/KitsuneKode";

export type WorkshopKind = "CLI" | "Web app" | "Editor themes" | "Terminal tool";

export type WorkshopProject = {
  /** The GitHub repository name under KitsuneKode. */
  readonly repo: string;
  readonly name: string;
  readonly kind: WorkshopKind;
  readonly tagline: string;
  /** Primary language as a fallback when the live lookup is unavailable. */
  readonly language: string;
  readonly repoUrl: string;
  /** A live site or package page, when there is one. */
  readonly siteUrl?: string;
  readonly siteLabel?: string;
  /** Reviewed local assets; no iframe or runtime screenshot service. */
  readonly preview:
    | { readonly image: string; readonly alt: string }
    | { readonly code: string; readonly label: string };
};

function defineProject(
  input: Omit<WorkshopProject, "repoUrl"> & { readonly repoUrl?: string },
): WorkshopProject {
  return { ...input, repoUrl: input.repoUrl ?? `${OWNER}/${input.repo}` };
}

export const workshop: readonly WorkshopProject[] = [
  defineProject({
    repo: "nvchad-themes",
    name: "NvChad Themes",
    kind: "Editor themes",
    tagline:
      "94 base46 palettes for VS Code, Cursor and Zed, with matching themes for your coding agents.",
    language: "HTML",
    preview: {
      image: "/workshop/nvchad-tokyonight.webp",
      alt: "NvChad Tokyonight in Cursor, showing a real TypeScript editor",
    },
  }),
  defineProject({
    repo: "sweep",
    name: "sweep",
    kind: "CLI",
    tagline:
      "Safe, fast artifact cleanup for any project tree: node_modules, dist, .next and target, with hard guardrails.",
    language: "TypeScript",
    siteUrl: "https://sweep.kitsunekode.in",
    preview: {
      image: "/workshop/sweep-site.png",
      alt: "sweep website social preview: safe project artifact cleanup",
    },
  }),
  defineProject({
    repo: "kittymux",
    name: "kittymux",
    kind: "Terminal tool",
    tagline: "An agent-aware workspace layer for kitty: sessions, brand glyphs and a usage HUD.",
    language: "Python",
    siteUrl: "https://kittymux.kitsunekode.in",
    preview: {
      image: "/workshop/kittymux-site.png",
      alt: "kittymux website social preview: workspaces for kitty",
    },
  }),
  defineProject({
    repo: "run-cli",
    name: "run-cli",
    kind: "CLI",
    tagline:
      "A Bun-native CLI that turns project startup into one command, with profiles and shell completions.",
    language: "TypeScript",
    preview: {
      image: "/workshop/run-cli.webp",
      alt: "run-cli project preview from its repository",
    },
  }),
  defineProject({
    repo: "js-questions-lab",
    name: "JS Questions Lab",
    kind: "Web app",
    tagline:
      "Interactive JavaScript interview practice with runnable snippets and an event-loop visualiser.",
    language: "TypeScript",
    siteUrl: "https://jsquestionslab.kitsunekode.in",
    siteLabel: "jsquestionslab.kitsunekode.in",
    preview: {
      image: "/workshop/jsquestionslab-project.png",
      alt: "JS Questions Lab repository preview from GitHub",
    },
  }),
  defineProject({
    repo: "yt-playlist-dedupe",
    name: "yt-playlist-dedupe",
    kind: "CLI",
    tagline: "A safe Bun CLI that scans a single YouTube playlist and removes duplicate videos.",
    language: "TypeScript",
    siteUrl: "https://yt-ddp.kitsunekode.in",
    siteLabel: "yt-ddp.kitsunekode.in",
    preview: {
      code: "Playlist → Review → Deduplicate\n\nKeep the videos you want.\nLeave duplicates behind.",
      label: "YouTube playlist tools",
    },
  }),
];

/** Stars are only worth printing once there are enough to mean something. */
export const STAR_DISPLAY_FLOOR = 5;

export type WorkshopMeta = {
  readonly stars: number | null;
  readonly language: string | null;
  /** ISO date of the last push, for the "updated" line. */
  readonly pushedAt: string | null;
};

/** What a card prints about a project. */
export type WorkshopFacts = {
  readonly language: string;
  readonly stars: number | null;
  readonly updated: string | null;
};

/** What the card shows for a project, given whatever the live lookup returned. */
export function presentWorkshopMeta(
  project: WorkshopProject,
  meta: WorkshopMeta | undefined,
): WorkshopFacts {
  const stars = meta?.stars ?? null;
  return {
    language: meta?.language ?? project.language,
    stars: stars !== null && stars >= STAR_DISPLAY_FLOOR ? stars : null,
    updated: meta?.pushedAt ? meta.pushedAt.slice(0, 10) : null,
  };
}
