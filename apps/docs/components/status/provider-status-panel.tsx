import {
  HistoryStrip,
  STATUS_VISUAL,
  StatusDonut,
  StatusPill,
} from "@/components/status/status-visuals";
import { codeMetadata } from "@/lib/code-metadata";
import { docsGithubIssuesUrl } from "@/lib/docs-github";
import {
  activeNotices,
  buildBoard,
  describeAge,
  donutSlices,
  freshness,
  overallStatus,
  STATUS_MEANING,
  UPTIME_MIN_DAYS,
  uptimePercent,
  type Board,
  type BoardGroup,
  type BoardRow,
  type BoardStatus,
  type Freshness,
  type NoticeLevel,
  type Overall,
  type OverallTone,
  type StatusNotice,
} from "@/lib/provider-status";
import { loadProviderStatus, statusDataBase, STATUS_FILES } from "@/lib/provider-status-live";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconChevronDown,
  IconInfoCircle,
  type Icon,
} from "@tabler/icons-react";

const WORKFLOW_RUNS_URL =
  "https://github.com/KitsuneKode/kunai/actions/workflows/provider-status-sweep.yml";

/** The order the states are listed in, healthy first, the unknown last. */
const STATE_ORDER: readonly BoardStatus[] = [
  "healthy",
  "degraded",
  "blocked",
  "down",
  "dead",
  "unchecked",
];

const NOTICE_VISUAL = {
  info: { icon: IconInfoCircle, tone: "[--status-c:var(--kunai-info)]" },
  warning: { icon: IconAlertTriangle, tone: "[--status-c:var(--kunai-warning)]" },
  incident: { icon: IconAlertOctagon, tone: "[--status-c:var(--kunai-danger)]" },
} satisfies Record<NoticeLevel, { icon: Icon; tone: string }>;

/** The overall verdict borrows the look of the provider state it most resembles. */
const OVERALL_AS = {
  good: "healthy",
  mixed: "degraded",
  bad: "dead",
  unknown: "unchecked",
} satisfies Record<OverallTone, BoardStatus>;

/**
 * The three columns of a provider row, and of the axis above it, so the strip's
 * ends line up with the dates printed over them.
 */
const ROW_GRID = "md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,11.5rem)]";

/**
 * The provider status board: what the daily check found, honestly dated.
 *
 * A server component that loads its own data (the sweep's latest result, its
 * history and any maintainer notices, live where it can and bundled where it
 * cannot), so it works the same on the `/status` page and embedded in the guide.
 *
 * Three things here exist because the old board was quietly wrong:
 *
 * - **It says how old it is, loudly.** The daily check once stopped reporting and
 *   the board went on showing three-week-old results as though they were current.
 *   Past thirty hours it says the check is late; past three days, that it is not
 *   running and the results may be out of date, and the ring and the headline stop
 *   sounding confident.
 * - **It lists every registered provider.** A provider the check has no result for
 *   is shown as "Not checked", not left out, because a missing row reads as a clean
 *   bill of health.
 * - **It carries notices.** A maintainer can post a line about a known problem by
 *   editing one file, and it shows here with no release.
 */
export async function ProviderStatusPanel({
  now = Date.now(),
}: {
  /** The clock, injectable so freshness can be tested without depending on the calendar. */
  readonly now?: number;
} = {}) {
  const status = await loadProviderStatus();
  const fresh = freshness(status.file.generatedAt, now);
  const board = buildBoard({
    providers: codeMetadata.providers,
    file: status.file,
    history: status.history,
    now,
  });
  const notices = activeNotices(status.notices, now);
  const overall = overallStatus(board, fresh);
  const recordedDays = board.groups.reduce(
    (most, group) => Math.max(most, ...group.rows.map((row) => row.recordedDays)),
    0,
  );

  return (
    <div className="not-prose flex flex-col gap-10">
      {notices.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {notices.map((notice) => (
            <li key={notice.id}>
              <NoticeCard notice={notice} />
            </li>
          ))}
        </ul>
      ) : null}
      {fresh.state === "late" ? (
        <FreshnessBanner fresh={fresh} generatedAt={status.file.generatedAt} />
      ) : null}
      <Overview
        board={board}
        overall={overall}
        fresh={fresh}
        generatedAt={status.file.generatedAt}
        live={status.source === "live"}
      />
      {recordedDays < UPTIME_MIN_DAYS ? (
        <p className="text-fd-muted-foreground m-0 -mt-4 text-xs leading-5 text-pretty">
          The history is new: {recordedDays} {recordedDays === 1 ? "day" : "days"} recorded so far,
          building up by one a day. Hollow bars are days nobody checked.
        </p>
      ) : null}
      {board.groups.map((group, index) => (
        <ModeGroup key={group.mode.id} group={group} showAxis={index === 0} />
      ))}
      <Legend />
      <HowItIsMeasured />
    </div>
  );
}

function checkedWhen(generatedAt: string): string {
  return `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 16)} UTC`;
}

/**
 * A day overdue, not yet dead. A stale board is not shown here: the overview card
 * carries that state itself, in its headline and its ring, so it is said once.
 */
function FreshnessBanner({
  fresh,
  generatedAt,
}: {
  readonly fresh: Freshness;
  readonly generatedAt: string;
}) {
  return (
    <output
      className={`${NOTICE_VISUAL.warning.tone} flex gap-3 rounded-xl border border-[var(--status-c)]/40 bg-[color-mix(in_oklab,var(--status-c)_8%,transparent)] p-4 text-sm`}
    >
      <IconAlertTriangle
        className="mt-0.5 size-4 shrink-0 text-[var(--status-c)]"
        stroke={1.75}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="text-fd-foreground m-0 font-medium">The daily check is later than usual</p>
        <p className="text-fd-muted-foreground m-0 leading-6">
          The last result is from <time dateTime={generatedAt}>{checkedWhen(generatedAt)}</time>,{" "}
          {describeAge(fresh.hours)}. What follows is probably still right, but it has not been
          confirmed today. <RunsLink />.
        </p>
      </div>
    </output>
  );
}

function RunsLink() {
  return (
    <a
      href={WORKFLOW_RUNS_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="text-fd-foreground underline underline-offset-4"
    >
      See the check's runs
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function NoticeCard({ notice }: { readonly notice: StatusNotice }) {
  const { icon: Glyph, tone } = NOTICE_VISUAL[notice.level];
  const names = notice.providers
    .map((id) => codeMetadata.providers.find((provider) => provider.id === id)?.displayName ?? id)
    .join(", ");
  return (
    <div
      className={`${tone} flex gap-3 rounded-xl border border-[var(--status-c)]/40 bg-[color-mix(in_oklab,var(--status-c)_8%,transparent)] p-4 text-sm`}
    >
      <Glyph
        className="mt-0.5 size-4 shrink-0 text-[var(--status-c)]"
        stroke={1.75}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="text-fd-foreground m-0 font-medium">
          {notice.title}
          {names ? <span className="text-fd-muted-foreground font-normal"> · {names}</span> : null}
        </p>
        {notice.body ? (
          <p className="text-fd-muted-foreground m-0 leading-6 text-pretty">{notice.body}</p>
        ) : null}
        <p className="text-fd-muted-foreground m-0 text-xs">
          Posted <time dateTime={notice.since}>{notice.since.slice(0, 10)}</time>
        </p>
      </div>
    </div>
  );
}

/**
 * The first thing on the page: how the providers divide among the states, in one
 * ring, with a sentence that says what that means.
 *
 * The headline is the board's own verdict (`overallStatus`), and it is deliberately
 * not an upbeat default: a stale board says it is out of date, and a board where
 * nothing resolved says that, with the reason it can be the check's network and not
 * the providers. The counts beside the ring are the same numbers as text, with each
 * state's glyph and word.
 */
function Overview({
  board,
  overall,
  fresh,
  generatedAt,
  live,
}: {
  readonly board: Board;
  readonly overall: Overall;
  readonly fresh: Freshness;
  readonly generatedAt: string;
  readonly live: boolean;
}) {
  const present = STATE_ORDER.filter((state) => board.counts[state] > 0);
  const stale = fresh.state === "stale";
  // A board that has stopped updating is a fault to fix, so it is drawn like one, not
  // in the muted grey of "unknown".
  const { icon: VerdictGlyph, tone } = STATUS_VISUAL[stale ? "dead" : OVERALL_AS[overall.tone]];
  const Glyph = stale ? IconAlertTriangle : VerdictGlyph;

  return (
    <section aria-labelledby="status-overview" className={`${tone} kunai-surface-shell`}>
      <div className="kunai-surface-shell__inner relative grid gap-7 overflow-hidden p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10 md:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,color-mix(in_oklab,var(--status-c)_10%,transparent),transparent_55%)]"
        />
        <div className="relative flex justify-center md:justify-start">
          <StatusDonut
            slices={donutSlices(board.counts, STATE_ORDER)}
            value={String(board.counts.healthy)}
            caption={stale ? `of ${board.total} at the last check` : `of ${board.total} resolving`}
            dimmed={stale}
          />
        </div>
        <div className="relative flex min-w-0 flex-col gap-4">
          <p className="text-fd-muted-foreground m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Glyph className="size-4 text-[var(--status-c)]" stroke={1.75} aria-hidden="true" />
            <span>
              {stale ? "Last checked" : "Checked"} {describeAge(fresh.hours)}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={generatedAt}>{checkedWhen(generatedAt)}</time>
            {live ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>the copy bundled with these docs</span>
              </>
            )}
          </p>
          <h2
            id="status-overview"
            className="kunai-display-title m-0 max-w-none text-3xl text-balance md:text-4xl"
          >
            {overall.headline}
          </h2>
          <p className="text-fd-muted-foreground m-0 max-w-xl text-sm leading-6 text-pretty">
            {overall.detail}
            {stale ? (
              <>
                {" "}
                <RunsLink />.
              </>
            ) : null}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm">
            {present.map((state) => {
              const { icon: StateGlyph, tone: stateTone } = STATUS_VISUAL[state];
              return (
                <li key={state} className={`${stateTone} flex items-center gap-1.5`}>
                  <StateGlyph
                    className="size-4 text-[var(--status-c)]"
                    stroke={1.75}
                    aria-hidden="true"
                  />
                  <span className="text-fd-foreground font-medium tabular-nums">
                    {board.counts[state]}
                  </span>
                  <span className="text-fd-muted-foreground">
                    {STATUS_MEANING[state].label.toLowerCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ModeGroup({
  group,
  showAxis,
}: {
  readonly group: BoardGroup;
  readonly showAxis: boolean;
}) {
  const healthy = group.rows.filter((row) => row.status === "healthy").length;
  return (
    <section aria-labelledby={`status-${group.mode.id}`}>
      <header className={`grid items-end gap-x-6 gap-y-1 px-3 pb-2 ${ROW_GRID}`}>
        <h3
          id={`status-${group.mode.id}`}
          className="text-fd-foreground m-0 flex flex-wrap items-baseline gap-x-2 text-base font-medium"
        >
          {group.mode.label}
          <span className="text-fd-muted-foreground text-xs font-normal tabular-nums">
            {healthy} of {group.rows.length} healthy
          </span>
        </h3>
        {/* The axis is printed once, over the first group: every strip below shares it. */}
        {showAxis ? (
          <div
            aria-hidden="true"
            className="text-fd-muted-foreground hidden justify-between text-[11px] md:flex"
          >
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        ) : (
          <span className="hidden md:block" />
        )}
        <span className="hidden md:block" />
      </header>
      <ul className="divide-fd-border border-fd-border m-0 flex list-none flex-col divide-y rounded-2xl border p-0">
        {group.rows.map((row) => (
          <li key={row.id}>
            <ProviderRow row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the resolve did, without the stream count: "Resolved in 1.9s", "Resolve exhausted". */
function resolveWord(row: BoardRow): string {
  const sweep = row.sweep;
  if (!sweep) return "No result yet";
  if (sweep.effectiveStatus !== "healthy") return `Resolve ${sweep.resolveStatus}`;
  if (sweep.resolveMs === null) return "Resolved";
  // A cached or local-fast resolve rounds to "0.0s", which is true and reads as broken.
  return sweep.resolveMs < 100
    ? "Resolved in under 0.1s"
    : `Resolved in ${(sweep.resolveMs / 1000).toFixed(1)}s`;
}

function resolveLine(row: BoardRow): string {
  const sweep = row.sweep;
  if (!sweep || sweep.effectiveStatus !== "healthy") return resolveWord(row);
  return `${resolveWord(row)} · ${sweep.streams} ${sweep.streams === 1 ? "stream" : "streams"}`;
}

/** The line under a strip: why, when it is not healthy and there is a reason; else what resolved. */
function captionFor(row: BoardRow): string {
  const note = row.sweep?.note ?? "";
  return row.status !== "healthy" && note ? note : resolveLine(row);
}

function stripSummary(row: BoardRow): string {
  if (row.recordedDays === 0) return `${row.name}: no daily checks recorded in the last 30 days`;
  return `${row.name}: healthy on ${row.healthyDays} of ${row.recordedDays} recorded days in the last 30`;
}

/**
 * What goes under the status pill: uptime once there is a week of history to make a
 * percentage mean something, the streak before that. One good day is "100%", which
 * says nothing, so it is not printed.
 */
function standingFor(row: BoardRow): string {
  if (row.recordedDays >= UPTIME_MIN_DAYS) {
    const percent = uptimePercent(row.healthyDays, row.recordedDays);
    if (percent !== null) return `${percent}% healthy over ${row.recordedDays} days`;
  }
  if (!row.streak) return "";
  const label = STATUS_MEANING[row.streak.status].label;
  return `${label} for ${row.streak.days} ${row.streak.days === 1 ? "day" : "days"}`;
}

type Fact = { readonly label: string; readonly value: string };

function factsFor(row: BoardRow): readonly Fact[] {
  const sweep = row.sweep;
  if (!sweep) return [];
  const facts: Fact[] = [
    {
      label: "Upstream",
      value: `${sweep.upstreamReachable ? "Reachable" : "Not reachable"}${
        sweep.upstreamHttp === null ? "" : ` · HTTP ${sweep.upstreamHttp}`
      }`,
    },
    { label: "Resolve", value: resolveWord(row) },
    { label: "Streams found", value: String(sweep.streams) },
  ];
  if (sweep.qualities.length > 0)
    facts.push({ label: "Qualities", value: sweep.qualities.join(", ") });
  if (sweep.servers.length > 0) facts.push({ label: "Servers", value: sweep.servers.join(", ") });
  if (sweep.audioLanguages.length > 0) {
    facts.push({ label: "Audio", value: sweep.audioLanguages.join(" / ") });
  }
  if (sweep.subtitleLanes > 0) {
    facts.push({
      label: "Subtitles",
      value: `${sweep.subtitleLanes} ${sweep.subtitleLanes === 1 ? "lane" : "lanes"}`,
    });
  }
  if (sweep.note) facts.push({ label: "Note", value: sweep.note });
  return facts;
}

/**
 * One provider: its name, its last thirty days, its state.
 *
 * A native disclosure, so the whole row is the control, it works by keyboard and
 * without JavaScript, and a screen reader announces it as expandable. Closed it
 * shows what a visitor came for (is it working, and has it been); open it shows the
 * measurements behind that.
 */
function ProviderRow({ row }: { readonly row: BoardRow }) {
  const facts = factsFor(row);
  const standing = standingFor(row);
  return (
    <details className="group/row kunai-status-row">
      <summary
        className={`grid cursor-pointer gap-x-6 gap-y-3 px-3 py-4 transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--kunai-surface-strong)_45%,transparent)] md:items-center ${ROW_GRID}`}
      >
        <div className="min-w-0">
          <h4 className="text-fd-foreground m-0 text-sm font-medium">{row.name}</h4>
          <p className="text-fd-muted-foreground m-0 mt-0.5 truncate font-mono text-xs">
            {row.domain}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <HistoryStrip cells={row.strip} summary={stripSummary(row)} />
          <p className="text-fd-muted-foreground m-0 text-xs leading-5 text-pretty">
            {captionFor(row)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <StatusPill status={row.status} />
            {standing ? (
              <span className="text-fd-muted-foreground text-xs tabular-nums md:text-right">
                {standing}
              </span>
            ) : null}
          </div>
          <IconChevronDown
            className="text-fd-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-open/row:rotate-180"
            stroke={1.5}
            aria-hidden="true"
          />
        </div>
      </summary>
      <div className="kunai-status-detail mx-3 mb-4 rounded-xl border border-[var(--kunai-line)] bg-[color-mix(in_oklab,var(--kunai-bg)_55%,transparent)] p-4">
        {facts.length > 0 ? (
          <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-fd-muted-foreground text-xs">{fact.label}</dt>
                <dd className="text-fd-foreground m-0 text-sm leading-6 text-pretty">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
            The daily check has no result for {row.name} yet. It is a registered provider; its
            health is just not measured here, which says nothing either way.
          </p>
        )}
      </div>
    </details>
  );
}

function Legend() {
  return (
    <section aria-labelledby="status-legend" className="flex flex-col gap-4">
      <h2 id="status-legend" className="text-fd-foreground m-0 text-lg font-medium">
        What the states mean
      </h2>
      <dl className="m-0 grid gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
        {STATE_ORDER.map((state) => (
          <div key={state} className="flex flex-col items-start gap-1.5">
            <dt>
              <StatusPill status={state} />
            </dt>
            <dd className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
              {STATUS_MEANING[state].meaning}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HowItIsMeasured() {
  const linkClass = "text-fd-foreground underline underline-offset-4";
  return (
    <section aria-labelledby="status-method" className="flex flex-col gap-2">
      <h2 id="status-method" className="text-fd-foreground m-0 text-lg font-medium">
        How this is measured
      </h2>
      <p className="text-fd-muted-foreground m-0 max-w-3xl text-sm leading-6 text-pretty">
        Once a day a scheduled job on GitHub's network resolves a known-good title through every
        provider and publishes the result. That is the provider's health from a clean network, not
        from yours: one that reads Region-gated here can work fine for you, and the other way round.
        You do not need this page to watch something. Kunai already demotes a provider that fails
        and moves to the next; this is for working out why one is struggling.
      </p>
      <p className="text-fd-muted-foreground m-0 text-sm">
        <a
          href={`${statusDataBase()}/${STATUS_FILES.status}`}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          The raw data
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {" · "}
        <a href={WORKFLOW_RUNS_URL} target="_blank" rel="noreferrer noopener" className={linkClass}>
          The check's runs
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {" · "}
        <a
          href={docsGithubIssuesUrl()}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          Report a provider problem
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </section>
  );
}
