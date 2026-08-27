import { SectionCards } from "@/components/analytics/section-cards";
import { ShareBars } from "@/components/analytics/share-bars";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { DocsAnalyticsMetrics } from "@/lib/analytics-metrics";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";
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

const BREAKDOWNS = [
  {
    key: "byVersion",
    label: "By version",
    hint: "Which release is running",
  },
  { key: "byOs", label: "By OS", hint: "Platform mix" },
  { key: "byArch", label: "By architecture", hint: "CPU mix" },
] as const;

function BreakdownCards({ metrics }: { readonly metrics: DocsAnalyticsMetrics }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 @2xl/analytics:grid-cols-3">
        {BREAKDOWNS.map((breakdown) => (
          <Card key={breakdown.key} className="@container/card">
            <CardHeader>
              <CardTitle className="text-sm">{breakdown.label}</CardTitle>
              <CardDescription>{breakdown.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ShareBars label={breakdown.label} counts={metrics[breakdown.key]} />
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground m-0 text-xs text-pretty">
        Each breakdown counts the same installs a different way, so the three add up to the same day
        total — they are not parts of one whole. Small-cell suppression is applied per breakdown; it
        is not a joint anonymity guarantee.
      </p>
    </div>
  );
}

function PayloadContractCard() {
  const payload = `{
  "installId": "<sha256 of a local id>",
  "version": "<semver>",
  "os": "<platform>",
  "arch": "<arch>",
  "ts": 0
}`;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Exact wire payload</CardTitle>
        <CardDescription>
          Nothing else is accepted. Extra keys — titles, queries, URLs — are rejected.
        </CardDescription>
        <CardAction>
          <CopyButton text={payload} label="payload" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted/40 text-foreground overflow-x-auto rounded-lg p-4 font-mono text-xs leading-6">
          {payload}
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

function GuaranteesCard() {
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
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>What Kunai promises</CardTitle>
        <CardDescription>The limits this page is bounded by.</CardDescription>
      </CardHeader>
      <CardContent>
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
                  <p className="text-muted-foreground m-0 text-sm leading-6 text-pretty">
                    {item.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

const CONTROLS = [
  { cmd: "/analytics", detail: "Show status and toggle consent" },
  { cmd: "/analytics show", detail: "Print the exact JSON that would be sent" },
  { cmd: "DO_NOT_TRACK=1", detail: "Hard-blocks sends even if enabled" },
] as const;

function ControlsSection() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="kunai-type-title text-xl">Control it in the CLI</h2>
      <div className="grid gap-4 @2xl/analytics:grid-cols-3">
        {CONTROLS.map((row) => (
          <Card key={row.cmd} size="sm" className="@container/card">
            <CardHeader>
              <CardTitle className="font-mono text-sm">{row.cmd}</CardTitle>
              <CardDescription>{row.detail}</CardDescription>
              <CardAction>
                <CopyButton text={row.cmd} label={row.cmd} />
              </CardAction>
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

export function UsagePanel({
  metrics,
  series,
}: {
  readonly metrics: DocsAnalyticsMetrics | null;
  readonly series: DocsAnalyticsSeries | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Alert className="border-border/80 bg-card/60">
        <IconShieldCheck />
        <AlertTitle>Optional · aggregates only · enable or disable in Settings</AlertTitle>
        <AlertDescription>
          Public day and lifetime counts, plus version, OS and architecture breakdowns. Never who is
          running Kunai, what they watched, or any install UUID.
        </AlertDescription>
      </Alert>

      {!metrics ? (
        <AnalyticsMetricsEmpty />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground m-0 text-xs">
              Snapshot day <span className="font-mono tabular-nums">{metrics.day}</span>
              {" · "}
              updated {formatUpdatedAt(metrics.updatedAt)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">schema v{metrics.schemaVersion}</Badge>
              <Badge variant="secondary">opt out with /analytics</Badge>
            </div>
          </div>

          <SectionCards metrics={metrics} series={series} />

          {metrics.activeInstalls === 0 ? <AnalyticsZeroDayEmpty day={metrics.day} /> : null}
        </div>
      )}
    </div>
  );
}

export function BreakdownSection({ metrics }: { readonly metrics: DocsAnalyticsMetrics | null }) {
  if (!metrics) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="kunai-type-title text-xl">Breakdowns</h2>
      <BreakdownCards metrics={metrics} />
    </section>
  );
}

export function TrustSection() {
  return (
    <>
      <section className="grid gap-4 @4xl/analytics:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <GuaranteesCard />
        <PayloadContractCard />
      </section>
      <ControlsSection />
    </>
  );
}
