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

/**
 * The people side of the project, on the home page: who makes it, how to help,
 * and who already does.
 *
 * It replaces a single strip that asked for money before it had said what the
 * money was for or offered anything free. Contributing comes first (it costs
 * nothing and is what a young project needs most); sponsorship sits beside it,
 * with what it pays for and an honest empty wall rather than a section that
 * quietly isn't there.
 *
 * Contributors are not listed as a wall because there is one human contributor
 * and a faux gallery would say otherwise; the maintainer is credited by name, and
 * the first outside contribution is an invitation, not a placeholder avatar.
 */
export function HomeOpenSource() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-7">
        <p className="text-fd-muted-foreground m-0 max-w-prose text-sm leading-6 text-pretty md:text-base">
          Kunai is MIT licensed and built in the open by{" "}
          <a
            href="https://github.com/KitsuneKode"
            target="_blank"
            rel="noreferrer noopener"
            className="text-fd-foreground underline decoration-[color-mix(in_oklab,var(--kunai-accent)_60%,transparent)] underline-offset-4"
          >
            KitsuneKode
            <span className="sr-only"> (opens GitHub in a new tab)</span>
          </a>
          . It has no accounts and no ads, so the only thing that keeps it working is someone
          keeping up with the providers. Three free ways to help:
        </p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {WAYS.map((way) => {
            const Glyph = way.icon;
            const body = (
              <>
                <span className="bg-fd-muted text-fd-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Glyph className="size-4" stroke={1.5} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fd-foreground text-sm font-medium">{way.title}</span>
                  <span className="text-fd-muted-foreground text-sm leading-5">{way.body}</span>
                </span>
                <IconArrowRight
                  aria-hidden="true"
                  className="text-fd-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] group-hover/way:translate-x-0.5"
                  stroke={1.5}
                />
              </>
            );
            const className =
              "group/way flex items-center gap-3 rounded-xl border border-[var(--kunai-line)] bg-[color-mix(in_oklab,var(--kunai-surface)_70%,transparent)] p-3.5 transition-[border-color,transform] duration-200 ease-[var(--ease-out)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_32%,var(--kunai-line))] active:scale-[0.99]";
            return (
              <li key={way.title}>
                {way.external ? (
                  <a
                    href={way.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={className}
                  >
                    {body}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={way.href} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <section aria-labelledby="home-sponsors-title" className="kunai-surface-shell lg:col-span-5">
        <div className="kunai-surface-shell__inner flex h-full flex-col gap-5 p-6 md:p-7">
          <div className="flex items-center gap-2.5">
            <IconHeart className="text-fd-primary size-5" stroke={1.5} aria-hidden="true" />
            <h3 id="home-sponsors-title" className="m-0 font-sans text-base font-medium">
              Sponsors
            </h3>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {SPONSOR_FUNDS.map((item) => (
              <li key={item.title} className="text-fd-muted-foreground text-sm leading-5">
                <span className="text-fd-foreground font-medium">{item.title}.</span> {item.body}
              </li>
            ))}
          </ul>
          <SponsorWall sponsors={sponsors} withAction={false} />
          <div className="mt-auto flex flex-wrap items-center gap-3">
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
        </div>
      </section>
    </div>
  );
}
