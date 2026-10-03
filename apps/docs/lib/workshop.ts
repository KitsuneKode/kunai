/**
 * The other things KitsuneKode makes: the home page section, the `/workshop`
 * page and the footer column all read this one list.
 *
 * Curated by hand, not read off the GitHub account: a profile fills up with
 * forks, experiments and coursework, and a showcase of "everything" says nothing
 * about what the maintainer stands behind. Every entry here is the maintainer's
 * own original work (not a fork), checked against the GitHub API when it was
 * added. `portless` is deliberately absent: it is a fork of an upstream project.
 *
 * Copy is written here rather than pulled from each repository's description, so
 * a page never prints a truncated or stale blurb, but each line restates what the
 * repository or its site itself says it does. Nothing here is a claim the project
 * does not make about itself.
 *
 * ## Order
 *
 * Products and playgrounds first: they have a live site, so they can show a real
 * preview, and they are the clearest answer to "what else does this person
 * build". Developer tools follow, with `sweep` leading them: it is the tool
 * most likely to gain a site of its own next, and its npm page stands in until
 * then. Within a group the order is deliberate, not alphabetical.
 */

const OWNER = "https://github.com/KitsuneKode";

export type WorkshopKind = "Playground" | "Web app" | "CLI" | "Terminal tool" | "Desktop tool";

/** Where a project sits on the page: shown with a preview, or listed as a tool. */
export type WorkshopGroup = "products" | "tools";

export type WorkshopProject = {
  /** The GitHub repository name under KitsuneKode, exactly as GitHub spells it. */
  readonly repo: string;
  readonly name: string;
  readonly kind: WorkshopKind;
  readonly group: WorkshopGroup;
  /** One line, for a card on the home page. */
  readonly tagline: string;
  /** Two sentences, for the project's card on `/workshop`. */
  readonly summary: string;
  /** Primary language as a fallback when the live lookup is unavailable. */
  readonly language: string;
  readonly repoUrl: string;
  /** A live site or package page, when there is one. */
  readonly siteUrl?: string;
  readonly siteLabel?: string;
  /**
   * A screenshot of the live site, bundled under `public/` so a visitor never
   * makes a request to anyone else's host for it. Absent for a project with no
   * site, which gets a typographic tile instead of a fabricated picture.
   */
  readonly preview?: string;
};

type ProjectInput = Omit<WorkshopProject, "repoUrl"> & { readonly repoUrl?: string };

function defineProject(input: ProjectInput): WorkshopProject {
  return { ...input, repoUrl: input.repoUrl ?? `${OWNER}/${input.repo}` };
}

export const workshop: readonly WorkshopProject[] = [
  defineProject({
    repo: "Kitsu-Lab",
    name: "Kitsu Lab",
    kind: "Playground",
    group: "products",
    tagline: "Components and design elements, each installable through the shadcn registry.",
    summary:
      "A playground for the components and design details behind the maintainer's UI library, from a keyboard button with spring-press physics to a PDF reader. Every exhibit installs through the shadcn registry.",
    language: "TypeScript",
    siteUrl: "https://kitsulab.kitsunekode.in",
    siteLabel: "kitsulab.kitsunekode.in",
    preview: "/workshop/kitsu-lab.webp",
  }),
  defineProject({
    repo: "kyma",
    name: "Kyma",
    kind: "Web app",
    group: "products",
    tagline: "Voice-first AI screening for tutor and communication-heavy hiring.",
    summary:
      "Runs a live, AI-led tutor interview and returns a structured, evidence-backed review packet, so hiring teams can judge clarity, patience and teaching ability consistently.",
    language: "TypeScript",
    siteUrl: "https://kyma.kitsunekode.in",
    siteLabel: "kyma.kitsunekode.in",
    preview: "/workshop/kyma.webp",
  }),
  defineProject({
    repo: "js-questions-lab",
    name: "JS Questions Lab",
    kind: "Web app",
    group: "products",
    tagline: "Interactive JavaScript interview practice with an event-loop visualiser.",
    summary:
      "Lydia Hallie's JavaScript questions, made runnable: execute the snippet in the browser, watch the event loop, and get feedback on the answer straight away.",
    language: "TypeScript",
    siteUrl: "https://jsquestionslab.kitsunekode.in",
    siteLabel: "jsquestionslab.kitsunekode.in",
    preview: "/workshop/js-questions-lab.webp",
  }),
  defineProject({
    repo: "sweep",
    name: "sweep",
    kind: "CLI",
    group: "tools",
    tagline: "Safe, fast cleanup of node_modules, dist, .next and target, with hard guardrails.",
    summary:
      "Recursively deletes the build artifacts that pile up across a project tree (node_modules, dist, .next, target and more), with hard guardrails around what it will remove. Published on npm.",
    language: "TypeScript",
    siteUrl: "https://www.npmjs.com/package/@kitsunekode/sweep",
    siteLabel: "npm",
  }),
  defineProject({
    repo: "kittymux",
    name: "kittymux",
    kind: "Terminal tool",
    group: "tools",
    tagline: "An agent-aware workspace layer for kitty.",
    summary:
      "Sessions, brand glyphs and a provider-usage HUD for the kitty terminal, built around working with coding agents.",
    language: "Python",
  }),
  defineProject({
    repo: "yt-playlist-dedupe",
    name: "YT Dedupe",
    kind: "CLI",
    group: "tools",
    tagline: "Scan one YouTube playlist and remove its duplicate videos.",
    summary:
      "A Bun and TypeScript CLI that scans a single playlist and removes the duplicates, built to be safe to run on a playlist you care about.",
    language: "TypeScript",
    siteUrl: "https://yt-ddp.kitsunekode.in",
    siteLabel: "yt-ddp.kitsunekode.in",
    preview: "/workshop/yt-playlist-dedupe.webp",
  }),
  defineProject({
    repo: "hyprland-caffeine-mode",
    name: "Caffeine Mode",
    kind: "Desktop tool",
    group: "tools",
    tagline: "Manual idle inhibition for Hyprland, Hypridle and Waybar.",
    summary:
      "A portable, manual switch for idle inhibition on Hyprland, Hypridle and Waybar. Its state survives Waybar restarts and theme reloads.",
    language: "TypeScript",
  }),
];

/** The projects in a group, in list order. */
export function projectsIn(group: WorkshopGroup): readonly WorkshopProject[] {
  return workshop.filter((project) => project.group === group);
}

/** Where a project's name should take you: its site when it has one, else its source. */
export function primaryUrl(project: WorkshopProject): string {
  return project.siteUrl ?? project.repoUrl;
}

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
