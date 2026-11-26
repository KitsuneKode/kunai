import { SponsorWall } from "@/components/support/sponsor-wall";
import { docsGithubIssueTemplateUrl } from "@/lib/docs-github";
import { SPONSOR_FUNDS, SPONSOR_URL, SUPPORT_PATH, sponsors } from "@/lib/support";
import {
  IconArrowRight,
  IconBrandGithub,
  IconBug,
  IconGitPullRequest,
  IconHeart,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";

const REPO = "https://github.com/KitsuneKode/kunai";
const GOOD_FIRST_ISSUES = `${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`;

type Way = {
  readonly icon: Icon;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly external: boolean;
};

const WAYS: readonly Way[] = [
  {
    icon: IconBug,
    title: "Report a broken provider",
    body: "The most useful thing to hear about. Say which one and what you saw.",
    href: docsGithubIssueTemplateUrl("provider_issue.yml"),
    external: true,
  },
  {
    icon: IconGitPullRequest,
    title: "Send a fix",
    body: "A clearer error, a guide that was wrong, an adapter that drifted.",
    href: "/docs/developer/contribute",
    external: false,
  },
  {
    icon: IconBrandGithub,
    title: "Pick a good first issue",
    body: "Small, scoped and labelled, for a first contribution.",
    href: GOOD_FIRST_ISSUES,
    external: true,
  },
];

/** Open-source contribution paths alongside GitHub Sponsors details. */
export function HomeOpenSource({ starCta }: { readonly starCta?: React.ReactNode } = {}) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-7">
        <p className="m-0 max-w-prose text-sm leading-6 text-pretty text-[var(--home-text-3)] md:text-[0.9375rem]">
          Kunai is MIT licensed and built in the open by{" "}
          <a
            href="https://github.com/KitsuneKode"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--home-text-1)] underline decoration-[color-mix(in_oklab,var(--kunai-accent)_60%,transparent)] underline-offset-4"
          >
            KitsuneKode
            <span className="sr-only"> (opens GitHub in a new tab)</span>
          </a>
          . It has no accounts and no ads, so the only thing that keeps it working is someone
          keeping up with the providers. Three free ways to help:
        </p>
        <ul className="kunai-row-list">
          {WAYS.map((way) => {
            const Glyph = way.icon;
            const body = (
              <>
                <span className="kunai-editorial-row__icon" aria-hidden="true">
                  <Glyph className="size-4" stroke={1.5} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-[var(--home-text-1)]">{way.title}</span>
                  <span className="text-sm leading-5 text-[var(--home-text-3)]">{way.body}</span>
                </span>
                <IconArrowRight className="kunai-row-arrow size-4 shrink-0" stroke={1.5} />
              </>
            );
            return (
              <li key={way.title} className="kunai-row-item">
                {way.external ? (
                  <a
                    href={way.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="kunai-editorial-row"
                  >
                    {body}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={way.href} className="kunai-editorial-row">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {starCta ? <div className="pt-1">{starCta}</div> : null}
      </div>

      <section aria-labelledby="home-sponsors-title" className="kunai-bento-tile lg:col-span-5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <IconHeart
              className="size-5 text-[var(--home-lane-kunai)]"
              stroke={1.5}
              aria-hidden="true"
            />
            <h3
              id="home-sponsors-title"
              className="m-0 font-sans text-base font-medium text-[var(--home-text-1)]"
            >
              Sponsors
            </h3>
          </div>
          <span className="rounded-full border border-[var(--home-hair-strong)] bg-[var(--home-well)] px-2.5 py-0.5 font-mono text-xs text-[var(--home-text-3)]">
            4 slots open
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-pretty text-[var(--home-text-2)]">
          Put your product in front of terminal-first developers across the homepage, docs, and
          README — plus a dedicated shoutout on X.
        </p>
        <div className="mt-4">
          <SponsorWall sponsors={sponsors} withAction={false} />
        </div>
        <ul className="m-0 mt-5 flex list-none flex-col gap-2 border-t border-[var(--home-hair)] p-0 pt-4">
          {SPONSOR_FUNDS.map((item) => (
            <li key={item.title} className="text-xs leading-5 text-[var(--home-text-3)]">
              <span className="font-medium text-[var(--home-text-1)]">{item.title}.</span>{" "}
              {item.body}
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
          <a
            className="kunai-button kunai-button-primary"
            href={SPONSOR_URL}
            rel="noreferrer noopener"
            target="_blank"
          >
            <IconHeart className="mr-1.5 size-4" stroke={1.5} />
            <span>Sponsor</span>
            <span className="sr-only"> (opens GitHub Sponsors in a new tab)</span>
          </a>
          <Link className="kunai-button kunai-button-quiet" href={SUPPORT_PATH}>
            How it is spent
          </Link>
        </div>
      </section>
    </div>
  );
}
