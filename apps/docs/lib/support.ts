import { docsGithubIssueTemplateUrl, docsGithubRepoUrl } from "./docs-github";

/**
 * Everything the support surfaces say about backing Kunai, in one place.
 *
 * The home page, the `/support` page and the footer all read from here, so a
 * changed sponsor link or a new sponsor is one edit. `.github/FUNDING.yml`
 * cannot import this, which is why `apps/docs/test/support.test.tsx` pins the
 * two together.
 */

export const SPONSOR_URL = "https://github.com/sponsors/KitsuneKode";

/** The site path `.github/FUNDING.yml` points its custom button at. */
export const SUPPORT_PATH = "/support";

export type Sponsor = {
  readonly name: string;
  /** Where the name links. Omit for a sponsor who prefers a plain name. */
  readonly url?: string;
};

/**
 * Who has sponsored, by their own choice.
 *
 * A committed list rather than a live fetch: a sponsor's name on a public page
 * is something they agree to, so it is added by hand, and the page never goes
 * blank or leaks a private sponsor because an API call failed. Empty is the
 * true state today and the page says so instead of hiding the section.
 */
export const sponsors: readonly Sponsor[] = [];

export type SupportWay = {
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly cta: string;
  readonly external: boolean;
};

/** Ways to help that cost nothing, ahead of the one that costs money. */
export function supportWays(): readonly SupportWay[] {
  return [
    {
      title: "Report a provider that broke",
      body: "A provider that stops resolving is the most useful thing to hear about. Say which one and what you saw.",
      href: docsGithubIssueTemplateUrl("provider_issue.yml"),
      cta: "Report a provider issue",
      external: true,
    },
    {
      title: "Star the repository",
      body: "It is the cheapest signal that Kunai is worth keeping alive, and it helps other people find it.",
      href: docsGithubRepoUrl(),
      cta: "Star on GitHub",
      external: true,
    },
    {
      title: "Improve the docs or the code",
      body: "Fixes to a guide, a clearer error message or a provider adapter are all welcome.",
      href: "/docs/developer/contribute",
      cta: "Read the contributor guide",
      external: false,
    },
  ];
}

/** What sponsorship pays for, stated as work rather than as a target. */
export const SPONSOR_FUNDS = [
  {
    title: "Keeping providers working",
    body: "Providers change their keys and layouts regularly. Keeping up takes time every few weeks.",
  },
  {
    title: "The public usage pulse",
    body: "The small server behind the opt-in analytics page, which publishes counts and nothing else.",
  },
  {
    title: "Making the docs and the shell better",
    body: "Time for the unglamorous work: testing on three platforms, writing things down, fixing papercuts.",
  },
] as const;

/** What it does not buy. Said plainly because the absence is the promise. */
export const SPONSOR_PROMISES = [
  "There is no paid tier. Every feature is free for everyone.",
  "Sponsoring collects nothing about you beyond what GitHub already holds.",
] as const;
