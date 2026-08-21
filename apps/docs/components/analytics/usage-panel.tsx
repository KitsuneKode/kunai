import { ShareBars } from "@/components/analytics/share-bars";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { DocsAnalyticsMetrics } from "@/lib/analytics-metrics";
import {
  IconEyeOff,
  IconLock,
  IconRadar2,
  IconShieldCheck,
  IconTerminal2,
} from "@tabler/icons-react";
import Link from "next/link";

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

/**
 * The one number the page leads with. Proportional figures, UI sans — tabular
 * digits and a serif face both read as decoration at display size.
 */
function HeroFigure({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
        {label}
      </p>
      <p className="text-foreground text-5xl leading-none font-semibold tracking-tight md:text-6xl">
        {value.toLocaleString("en-US")}
      </p>
      <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
        {label}
      </p>
      <p className="text-foreground text-3xl leading-none font-semibold tracking-tight">
        {value.toLocaleString("en-US")}
      </p>
      <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
    </div>
  );
}

function BreakdownGrid({ metrics }: { readonly metrics: DocsAnalyticsMetrics }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        <ShareBars label="By version" counts={metrics.byVersion} />
        <ShareBars label="By OS" counts={metrics.byOs} />
        <ShareBars label="By architecture" counts={metrics.byArch} />
      </div>
      <p className="text-muted-foreground m-0 text-xs text-pretty">
        Each breakdown counts the same installs a different way, so the three add up to the same day
        total — they are not parts of one whole. Groups smaller than 5 installs are reported as{" "}
        <code className="font-mono">other</code>. This small-cell suppression is applied per
        breakdown; it is not a joint anonymity guarantee.
      </p>
    </div>
  );
}

function PayloadContractCard() {
  return (
    <Card size="sm" className="bg-card/80">
      <CardHeader className="border-border border-b">
        <CardTitle>Exact wire payload</CardTitle>
        <CardDescription>
          Nothing else is accepted. Extra keys (titles, queries, URLs) are rejected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted/40 text-foreground overflow-x-auto rounded-lg p-4 font-mono text-xs leading-6">
          {`{
  "installId": "<sha256 of a local id>",
  "version": "<semver>",
  "os": "<platform>",
  "arch": "<arch>",
  "ts": 0
}`}
        </pre>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <p className="text-muted-foreground m-0 text-xs">
          Preview locally with <code className="font-mono">/analytics show</code>
        </p>
        <Badge variant="secondary">opt-in</Badge>
      </CardFooter>
    </Card>
  );
}

function GuaranteesList() {
  const items = [
    {
      icon: IconEyeOff,
      title: "No watch history leaves the machine",
      body: "Titles, queries, providers, stream URLs, and file paths are never transmitted.",
    },
    {
      icon: IconLock,
      title: "Install ids are hashed before storage",
      body: "The ingest keeps HMAC hashes of the install id with your platform, architecture, and version — never a raw UUID.",
    },
    {
      icon: IconShieldCheck,
      title: "You are told before anything sends",
      body: "Setup asks up front, or a one-time notice appears on first launch. That first run always sends nothing. DO_NOT_TRACK and CI hard-block sends even if the setting says on.",
    },
  ] as const;

  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li className="flex gap-3" key={item.title}>
            <span className="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-4" stroke={1.5} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-foreground m-0 text-sm font-medium">{item.title}</p>
              <p className="text-muted-foreground m-0 text-sm leading-6 text-pretty">{item.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AnalyticsMetricsEmpty() {
  return (
    <Empty className="border-border bg-muted/20 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconRadar2 />
        </EmptyMedia>
        <EmptyTitle>Public pulse not published yet</EmptyTitle>
        <EmptyDescription className="max-w-md text-pretty">
          The aggregate snapshot is missing or unreachable. That usually means the ingest cron has
          not run, the metrics URL is wrong, or the deployment is still warming up.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/docs/users/reliability-and-privacy#usage-analytics" />}
          nativeButton={false}
        >
          Read the privacy rules
        </Button>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/docs/users/cli-reference" />}
          nativeButton={false}
        >
          CLI reference
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function AnalyticsZeroDayEmpty({ day }: { readonly day: string }) {
  return (
    <Empty className="border-border/80 bg-card/40 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconTerminal2 />
        </EmptyMedia>
        <EmptyTitle>No pings for {day}</EmptyTitle>
        <EmptyDescription className="max-w-md text-pretty">
          The snapshot is live, but yesterday’s distinct count is zero. That is normal early on, or
          if everyone nearby opted out with <code className="font-mono">/analytics</code>.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function UsagePanel({ metrics }: { readonly metrics: DocsAnalyticsMetrics | null }) {
  return (
    <div className="flex flex-col gap-8">
      <Alert className="border-border/80 bg-card/60">
        <IconShieldCheck />
        <AlertTitle>Optional · enable or disable in Settings · aggregates only</AlertTitle>
        <AlertDescription>
          This page shows public day/lifetime counts and version, OS, and architecture breakdowns.
          It never shows who is running Kunai, what they watched, or any install UUID. Abuse can
          inflate a counter; it cannot expose a watch history.
        </AlertDescription>
      </Alert>

      {!metrics ? (
        <AnalyticsMetricsEmpty />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-border gap-3 border-b md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">Public usage pulse</CardTitle>
                <Badge variant="outline">schema v{metrics.schemaVersion}</Badge>
              </div>
              <CardDescription>
                Snapshot day <span className="font-mono tabular-nums">{metrics.day}</span>
                {" · "}
                updated {formatUpdatedAt(metrics.updatedAt)}
              </CardDescription>
            </div>
            <Badge variant="secondary">opt out with /analytics</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-8 pt-2">
            {metrics.activeInstalls === 0 ? <AnalyticsZeroDayEmpty day={metrics.day} /> : null}
            <div className="grid items-end gap-8 md:grid-cols-2">
              <HeroFigure
                label="Yesterday’s active installs"
                value={metrics.activeInstalls}
                hint="Distinct installs that pinged on the snapshot day."
              />
              <StatTile
                label="Lifetime installs"
                value={metrics.lifetimeInstalls}
                hint="Exact distinct installs ever seen."
              />
            </div>
            <BreakdownGrid metrics={metrics} />
          </CardContent>
          <CardFooter>
            <p className="text-muted-foreground m-0 text-xs text-pretty">
              Lifetime is exact — the server keeps one hashed row per install, not a forever UUID
              list.
            </p>
          </CardFooter>
        </Card>
      )}

      <Separator />

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-4">
          <h2 className="kunai-type-title text-xl">What Kunai promises</h2>
          <GuaranteesList />
        </div>
        <PayloadContractCard />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="kunai-type-title text-xl">Control it in the CLI</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { cmd: "/analytics", detail: "Show status and toggle consent" },
            { cmd: "/analytics show", detail: "Print the exact JSON that would be sent" },
            { cmd: "DO_NOT_TRACK=1", detail: "Hard-blocks sends even if enabled" },
          ].map((row) => (
            <Card key={row.cmd} size="sm">
              <CardHeader>
                <CardTitle className="font-mono text-sm">{row.cmd}</CardTitle>
                <CardDescription>{row.detail}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/docs/users/reliability-and-privacy#usage-analytics" />}
            nativeButton={false}
          >
            Full privacy guide
          </Button>
          <Button variant="ghost" size="sm" render={<Link href="/feedback" />} nativeButton={false}>
            Feedback
          </Button>
        </div>
      </section>
    </div>
  );
}
