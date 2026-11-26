import { SponsorWall } from "@/components/support/sponsor-wall";
import { Button } from "@/components/ui/button";
import { buildPageMetadata } from "@/lib/page-metadata";
import {
  SPONSOR_BENEFITS,
  SPONSOR_FUNDS,
  SPONSOR_PROMISES,
  SPONSOR_URL,
  sponsors,
  supportWays,
} from "@/lib/support";
import { IconArrowUpRight, IconChartLine, IconCheck, IconHeart } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = buildPageMetadata({
  title: "Support Kunai: sponsor the project or help in other ways",
  absoluteTitle: true,
  description:
    "Kunai is free and MIT licensed. See what sponsorship pays for, what sponsors receive, who backs the project, and the free ways to help.",
  socialDescription:
    "Kunai is free and MIT licensed. Sponsor the project, claim a founding dock slot, or help by reporting a broken provider or contributing.",
  path: "/support",
});

export default function SupportPage() {
  const ways = supportWays();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 py-14 md:px-10">
      <header className="flex flex-col gap-5 border-b border-[var(--home-hair)] pb-10">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Support Kunai</h1>
        <p className="max-w-2xl text-base leading-7 text-pretty text-[var(--home-text-2)]">
          Kunai is free, MIT licensed, and has no accounts or ads. It keeps working because someone
          keeps up with the providers it plays from. Sponsor to fund that upkeep and feature your
          product across Kunai&apos;s homepage, docs, and README.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="kunai-button kunai-button-primary"
          >
            <IconHeart className="mr-1.5 size-4 text-[#d85f86]" stroke={1.75} />
            <span>Sponsor on GitHub</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Button variant="ghost" render={<Link href="/analytics" />} nativeButton={false}>
            <IconChartLine className="size-4" stroke={1.5} />
            See public usage pulse
          </Button>
          <Button variant="ghost" render={<Link href="#other-ways" />} nativeButton={false}>
            Prefer a free way to help?
          </Button>
        </div>
      </header>

      <section
        id="sponsor-benefits"
        aria-labelledby="sponsors"
        className="flex scroll-mt-24 flex-col gap-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="sponsors" className="kunai-home-h2">
            Sponsors &amp; open founding slots
          </h2>
          <span className="font-mono text-xs text-[var(--home-text-4)]">
            Hover a slot to preview · click to sponsor
          </span>
        </div>

        <div className="kunai-bento-tile">
          <SponsorWall sponsors={sponsors} wide />
        </div>

        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {SPONSOR_BENEFITS.map((benefit) => (
            <li key={benefit.title} className="kunai-bento-tile">
              <h3 className="m-0 font-sans text-base font-medium text-[var(--home-text-1)]">
                {benefit.title}
              </h3>
              <p className="m-0 mt-2.5 text-sm leading-6 text-pretty text-[var(--home-text-3)]">
                {benefit.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="funds" className="flex flex-col gap-6">
        <h2 id="funds" className="kunai-home-h2">
          What sponsorship pays for
        </h2>
        <ul className="m-0 flex list-none flex-col divide-y divide-[var(--home-hair)] border-t border-b border-[var(--home-hair)] p-0">
          {SPONSOR_FUNDS.map((item) => (
            <li
              key={item.title}
              className="grid gap-1.5 py-5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8"
            >
              <h3 className="m-0 font-sans text-base font-medium text-[var(--home-text-1)]">
                {item.title}
              </h3>
              <p className="m-0 text-sm leading-6 text-pretty text-[var(--home-text-3)]">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {SPONSOR_PROMISES.map((promise) => (
            <li key={promise} className="flex items-start gap-2 text-sm text-[var(--home-text-3)]">
              <IconCheck
                className="mt-0.5 size-4 shrink-0 text-[var(--home-lane-kunai)]"
                stroke={1.5}
              />
              {promise}
            </li>
          ))}
        </ul>
      </section>

      <section id="other-ways" aria-labelledby="ways" className="flex scroll-mt-24 flex-col gap-5">
        <h2 id="ways" className="kunai-home-h2">
          Other ways to help
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {ways.map((way) => {
            const body = (
              <>
                <h3 className="m-0 flex items-center justify-between gap-2 font-sans text-base font-medium text-[var(--home-text-1)]">
                  {way.title}
                  <IconArrowUpRight
                    className="hover-fine:group-hover/way:translate-x-0.5 hover-fine:group-hover/way:-translate-y-0.5 size-4 shrink-0 text-[var(--home-text-4)] transition-transform duration-150 ease-[var(--ease-out)]"
                    stroke={1.5}
                  />
                </h3>
                <p className="m-0 text-sm leading-6 text-pretty text-[var(--home-text-3)]">
                  {way.body}
                </p>
                <span className="mt-auto pt-2 text-sm text-[var(--home-lane-kunai)]">
                  {way.cta}
                </span>
              </>
            );
            const className =
              "group/way kunai-workshop-card flex h-full flex-col gap-3 p-5 no-underline";
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
      </section>
    </main>
  );
}
