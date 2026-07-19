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
import type { DocsTelemetryMetrics } from "@/lib/telemetry-metrics";
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

function MetricHero({
  label,
  value,
  hint,
  approximate = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
  readonly approximate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
        {label}
      </p>
      <p className="text-foreground font-heading text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
        {approximate ? "~" : ""}
        {value.toLocaleString("en-US")}
      </p>
      <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
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
  "installId": "<uuid>",
  "version": "<semver>",
  "os": "<platform>",
  "arch": "<arch>",
  "ts": 0
}`}
        </pre>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <p className="text-muted-foreground m-0 text-xs">
          Preview locally with <code className="font-mono">/telemetry show</code>
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
      body: "The ingest keeps HMAC hashes for daily distinct counts and a lifetime HyperLogLog — not raw UUIDs.",
    },
    {
      icon: IconShieldCheck,
      title: "Decline stays decline",
      body: "Fresh installs send nothing. DO_NOT_TRACK and CI hard-block sends even if config says enabled.",
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

export function TelemetryMetricsEmpty() {
  return (
    <Empty className="border-border bg-muted/20 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconRadar2 />
        </EmptyMedia>
        <EmptyTitle>Public pulse not published yet</EmptyTitle>
        <EmptyDescription className="max-w-md text-pretty">
          The aggregate snapshot is missing or unreachable. That usually means the ingest cron has
          not run, the metrics URL is wrong, or the deployment is still warming up. Your CLI still
          defaults to zero network until you opt in.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/docs/users/reliability-and-privacy#opt-in-telemetry" />}
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

export function TelemetryZeroDayEmpty({ day }: { readonly day: string }) {
  return (
    <Empty className="border-border/80 bg-card/40 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconTerminal2 />
        </EmptyMedia>
        <EmptyTitle>No opt-in pings for {day}</EmptyTitle>
        <EmptyDescription className="max-w-md text-pretty">
          The snapshot is live, but yesterday’s distinct count is zero. That is normal early on —
          only consented installs send a daily ping.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function OptInUsagePanel({ metrics }: { readonly metrics: DocsTelemetryMetrics | null }) {
  return (
    <div className="flex flex-col gap-8">
      <Alert className="border-border/80 bg-card/60">
        <IconShieldCheck />
        <AlertTitle>Opt-in only · aggregates only</AlertTitle>
        <AlertDescription>
          This page shows public day/lifetime counts when the ingest publishes them. It never shows
          who opted in, what they watched, or any install UUID. Abuse can inflate a counter; it
          cannot expose a watch history.
        </AlertDescription>
      </Alert>

      {!metrics ? (
        <TelemetryMetricsEmpty />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-border gap-3 border-b md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">Public opt-in pulse</CardTitle>
                <Badge variant="outline">schema v{metrics.schemaVersion}</Badge>
              </div>
              <CardDescription>
                Snapshot day <span className="font-mono tabular-nums">{metrics.day}</span>
                {" · "}
                updated {formatUpdatedAt(metrics.updatedAt)}
              </CardDescription>
            </div>
            <Badge variant="secondary">lifetime via {metrics.lifetimeMethod}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-8 pt-2">
            {metrics.activeInstalls === 0 ? <TelemetryZeroDayEmpty day={metrics.day} /> : null}
            <div className="grid gap-8 md:grid-cols-2">
              <MetricHero
                label="Yesterday’s opt-in installs"
                value={metrics.activeInstalls}
                hint="Distinct consented installs that pinged on the snapshot day."
              />
              <MetricHero
                label="Lifetime opt-in estimate"
                value={metrics.lifetimeInstallsApprox}
                approximate
                hint="Approximate distinct installs ever (HyperLogLog). Not exact by design."
              />
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-muted-foreground m-0 text-xs text-pretty">
              Lifetime is approximate on purpose so the server never needs a forever UUID list.
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
            { cmd: "/telemetry", detail: "Show status and toggle consent" },
            { cmd: "/telemetry show", detail: "Print the exact JSON that would be sent" },
            { cmd: "DO_NOT_TRACK=1", detail: "Hard-blocks sends and enable" },
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
            render={<Link href="/docs/users/reliability-and-privacy#opt-in-telemetry" />}
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
