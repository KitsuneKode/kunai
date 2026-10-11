import { SponsorWall } from "@/components/support/sponsor-wall";
import { Button } from "@/components/ui/button";
import { buildPageMetadata } from "@/lib/page-metadata";
import { SPONSOR_FUNDS, SPONSOR_PROMISES, SPONSOR_URL, sponsors, supportWays } from "@/lib/support";
import { IconArrowUpRight, IconCheck, IconHeart } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = buildPageMetadata({
  title: "Support Kunai: sponsor the project or help in other ways",
  absoluteTitle: true,
  description:
    "Kunai is free and MIT licensed. See what sponsorship pays for, who backs the project, and the free ways to help: report a broken provider, star the repository, or contribute.",
  socialDescription:
    "Kunai is free and MIT licensed. Sponsor the project, or help by reporting a broken provider or contributing.",
  path: "/support",
});

export default function SupportPage() {
  const ways = supportWays();

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-5 border-b pb-10">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Support Kunai</h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7 text-pretty">
          Kunai is free, MIT licensed, and has no accounts or ads. It keeps working because someone
          keeps up with the providers it plays from. If it saves you time, here is how to help.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            render={<Link href={SPONSOR_URL} target="_blank" rel="noreferrer noopener" />}
            nativeButton={false}
          >
            <IconHeart stroke={1.5} />
            Sponsor on GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </Button>
          <Button variant="ghost" render={<Link href="#other-ways" />} nativeButton={false}>
            Prefer a free way to help?
          </Button>
        </div>
      </header>

      <section aria-labelledby="funds" className="flex flex-col gap-6">
        <h2 id="funds" className="kunai-type-title text-2xl">
          What sponsorship pays for
        </h2>
        <ul className="divide-border m-0 flex list-none flex-col divide-y p-0">
          {SPONSOR_FUNDS.map((item) => (
            <li
              key={item.title}
              className="grid gap-1 py-5 first:pt-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8"
            >
              <h3 className="text-foreground m-0 text-base font-medium">{item.title}</h3>
              <p className="text-muted-foreground m-0 text-sm leading-6 text-pretty">{item.body}</p>
            </li>
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {SPONSOR_PROMISES.map((promise) => (
            <li key={promise} className="text-muted-foreground flex items-start gap-2 text-sm">
              <IconCheck className="text-primary mt-0.5 size-4 shrink-0" stroke={1.5} />
              {promise}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sponsors" className="flex flex-col gap-5">
        <h2 id="sponsors" className="kunai-type-title text-2xl">
          Sponsors
        </h2>
        <SponsorWall sponsors={sponsors} />
      </section>

      <section id="other-ways" aria-labelledby="ways" className="flex scroll-mt-24 flex-col gap-5">
        <h2 id="ways" className="kunai-type-title text-2xl">
          Other ways to help
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {ways.map((way) => {
            const body = (
              <>
                <h3 className="text-foreground m-0 flex items-center justify-between gap-2 text-base font-medium">
                  {way.title}
                  <IconArrowUpRight
                    className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] group-hover/way:translate-x-0.5 group-hover/way:-translate-y-0.5"
                    stroke={1.5}
                  />
                </h3>
                <p className="text-muted-foreground m-0 text-sm leading-6 text-pretty">
                  {way.body}
                </p>
                <span className="text-primary mt-auto text-sm">{way.cta}</span>
              </>
            );
            const className =
              "group/way border-border bg-card/60 hover:border-primary flex h-full flex-col gap-3 rounded-xl border p-5 transition-[border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[0.98]";
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
