import type { HomeProviderMetadata } from "@/components/home/types";
import type { homeHighlights } from "@/lib/home-content";
import {
  IconCalendarEvent,
  IconDownload,
  IconHistory,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";

type Highlight = (typeof homeHighlights)[number];

type HomeBentoProps = {
  readonly highlights: readonly Highlight[];
  readonly providers: readonly HomeProviderMetadata[];
};

/** How many provider names the tile prints before it says "+N more". */
const PROVIDER_CHIP_LIMIT = 8;

const MODES = ["Anime", "Series", "Movies", "YouTube"] as const;

/**
 * What "everything stays one keystroke away" means, shown instead of listed.
 *
 * Four tiles of two sizes (7/5 over 5/7), not three equal cards: each carries a
 * small piece of the thing it describes (the four modes, the real provider names,
 * the commands you reach for when playback stalls), so the section demonstrates
 * the product where the old list of four rows only described it. Everything is
 * server-rendered, with no client JavaScript, and the numbers and names come from
 * the same generated metadata as the rest of the site, so nothing here is typed
 * twice.
 *
 * Each tile is a double bezel: an outer shell with a hairline, an inner plate with
 * its own highlight, and radii that nest (inner = outer minus the shell padding).
 */
export function HomeBento({ highlights, providers }: HomeBentoProps) {
  const byLabel = new Map(highlights.map((item) => [item.label, item.detail]));
  const providerNames = [...providers]
    .sort((a, b) => Number(b.recommended) - Number(a.recommended))
    .map((provider) => provider.displayName);
  const shown = providerNames.slice(0, PROVIDER_CHIP_LIMIT);
  const hidden = providerNames.length - shown.length;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
      <Tile
        className="md:col-span-7"
        label="Four catalog modes"
        detail={byLabel.get("Four catalog modes")}
      >
        <div className="mt-6 flex flex-wrap items-center gap-2" aria-hidden="true">
          {MODES.map((mode, index) => (
            <span
              key={mode}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                index === 0
                  ? "border-[var(--kunai-accent-deep)] bg-[color-mix(in_oklab,var(--kunai-accent)_12%,transparent)] text-[var(--kunai-accent)]"
                  : "text-fd-muted-foreground border-[var(--kunai-line)]"
              }`}
            >
              {mode}
            </span>
          ))}
          <kbd className="border-fd-border bg-fd-card text-fd-muted-foreground ml-1 rounded-md border px-2 py-1 font-mono text-xs">
            Tab
          </kbd>
        </div>
      </Tile>

      <Tile
        className="md:col-span-5"
        label="Direct providers"
        detail={byLabel.get("Direct providers")}
      >
        <p className="mt-5 flex items-baseline gap-3">
          <span className="text-fd-foreground font-sans text-5xl leading-none font-semibold tabular-nums">
            {providers.length}
          </span>
          <span className="text-fd-muted-foreground text-sm">
            adapters, resolved on your machine
          </span>
        </p>
        <ul className="m-0 mt-5 flex list-none flex-wrap gap-1.5 p-0">
          {shown.map((name) => (
            <li
              key={name}
              className="text-fd-muted-foreground rounded-md border border-[var(--kunai-line)] px-2 py-1 font-mono text-xs"
            >
              {name}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-fd-muted-foreground px-1 py-1 font-mono text-xs">+{hidden} more</li>
          ) : null}
        </ul>
      </Tile>

      <Tile
        className="md:col-span-5"
        label="Continue watching"
        detail={byLabel.get("Continue watching")}
      >
        <ul className="m-0 mt-6 grid list-none grid-cols-2 gap-x-4 gap-y-3 p-0">
          <Capability icon={IconHistory} label="History" />
          <Capability icon={IconCalendarEvent} label="Release calendar" />
          <Capability icon={IconSparkles} label="Recommendations" />
          <Capability icon={IconDownload} label="Offline downloads" />
        </ul>
      </Tile>

      <Tile
        className="md:col-span-7"
        label="Recovery built in"
        detail={byLabel.get("Recovery built in")}
      >
        <ol className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0">
          <Step command="/recover" meaning="First step when a stream stalls" />
          <Step command="/fallback" meaning="Try another provider (Shift+F during playback)" />
          <Step command="/diagnostics" meaning="See what happened, redacted by default" />
        </ol>
      </Tile>
    </div>
  );
}

function Tile({
  className,
  label,
  detail,
  children,
}: {
  readonly className?: string;
  readonly label: string;
  readonly detail: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={`kunai-surface-shell ${className ?? ""}`}>
      <div className="kunai-surface-shell__inner flex h-full flex-col p-6 md:p-7">
        <h3 className="kunai-step-label m-0">{label}</h3>
        {detail ? (
          <p className="kunai-type-body mt-3 max-w-prose text-sm text-pretty">{detail}</p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function Capability({ icon: Glyph, label }: { readonly icon: Icon; readonly label: string }) {
  return (
    <li className="text-fd-foreground flex items-center gap-2.5 text-sm">
      <span className="bg-fd-muted text-fd-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
        <Glyph className="size-4" stroke={1.5} />
      </span>
      {label}
    </li>
  );
}

function Step({ command, meaning }: { readonly command: string; readonly meaning: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <code className="text-fd-foreground rounded-md border border-[var(--kunai-line)] px-2 py-0.5 font-mono text-xs">
        {command}
      </code>
      <span className="text-fd-muted-foreground">{meaning}</span>
    </li>
  );
}
