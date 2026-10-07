import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CLOCK_SEAM_HOURS, CLOCK_SEAM_DAY } from "@/lib/analytics-derive";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";

/**
 * What the numbers on this page are, and why they look the way they do.
 *
 * The counts are small and the definitions are strict, so a few of them read as
 * wrong when they are not: 121 installs ever against 4 on a given day, a
 * platform chart that is one grey band, a dip on one date. Each entry below
 * answers one of those, in the order a reader hits them. The worked example uses
 * the newest published day rather than a made-up one, so the explanation can
 * never drift from the numbers sitting above it.
 *
 * A server component: it is text, it needs no state, and with JavaScript off it
 * is the part of the page that still explains the rest.
 */

type Entry = {
  readonly term: string;
  readonly body: React.ReactNode;
};

function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const value = (part / whole) * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

export function HowToRead({ series }: { readonly series: DocsAnalyticsSeries | null }) {
  const latest = series?.points.at(-1);

  const entries: readonly Entry[] = [
    {
      term: "Active",
      body: "Installs that sent a ping that day. An install is counted once a day however many times it runs, and only while it is opted in, so this is who ran Kunai that day, not who has it installed.",
    },
    {
      term: "New",
      body: "Installs whose very first ping was that day. They are already inside Active, never added on top of it.",
    },
    {
      term: "Lifetime",
      body: "Every distinct install ever seen, as a running total. It rises by New each day. An install silent for over 400 days leaves the live table but stays in the total, so Lifetime only ever grows.",
    },
    {
      term: "Why Active is so much smaller than Lifetime",
      body: latest ? (
        <>
          On {latest.day}, {latest.activeInstalls} installs ran Kunai and {latest.lifetimeInstalls}{" "}
          have ever run it: {percent(latest.activeInstalls, latest.lifetimeInstalls)}. That is
          normal for a tool people reach for now and then, and it is not a retention rate. Plenty of
          installs were tried once; many more are simply not used every day.
        </>
      ) : (
        "Lifetime counts everyone ever seen, Active only those who ran Kunai that day, so Active is always the smaller number. It is not a retention rate."
      ),
    },
    {
      term: "Other",
      body: "Any version, OS or architecture with fewer than five installs on any day in the window is folded into Other for the whole window, so a small group never blinks in and out of view. While the project is small that can be everyone, which is why the platform chart appears only once an OS clears the bar. Nothing is dropped: named groups plus Other always add up to Active.",
    },
    {
      term: "Days",
      body: (
        <>
          Days are India Standard Time (UTC+5:30) from 15 Sep 2026 and UTC before it.{" "}
          {CLOCK_SEAM_DAY} is where they join and covers {CLOCK_SEAM_HOURS} hours, so it reads low.
          The latest point is the last complete day; today is never drawn.
        </>
      ),
    },
    {
      term: "Installs, not people",
      body: "Someone on two machines counts twice. Turning usage stats off clears the install's random ID, and turning them back on makes a new one, which counts as a new install. Nothing here identifies anyone, which is also why it cannot be audited.",
    },
    {
      term: "Who is counted",
      body: "Only installs that turned usage stats on. Nothing is sent from CI, a non-interactive session, or with DO_NOT_TRACK set. Read the whole page as a lower bound.",
    },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>How to read these numbers</CardTitle>
        <CardDescription>
          What each figure counts, and why some of them look surprising.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="m-0 grid gap-x-8 gap-y-5 @3xl/card:grid-cols-2">
          {entries.map((entry) => (
            <div key={entry.term} className="flex flex-col gap-1">
              <dt className="text-foreground text-sm font-medium text-balance">{entry.term}</dt>
              <dd className="text-muted-foreground m-0 text-sm leading-6 text-pretty">
                {entry.body}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
