import type { HomeProviderMetadata } from "@/components/home/types";
import { withCssVars } from "@/lib/css-vars";
import type { homeHighlights } from "@/lib/home-content";
import {
  IconCalendarEvent,
  IconDownload,
  IconHistory,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import type { CSSProperties } from "react";

type Highlight = (typeof homeHighlights)[number];

type HomeBentoProps = {
  readonly highlights: readonly Highlight[];
  readonly providers: readonly HomeProviderMetadata[];
};

/** How many provider names the tile prints before it says "+N more". */
const PROVIDER_CHIP_LIMIT = 8;

const MODES = [
  { label: "Series & movies", laneVar: "var(--home-lane-series)" },
  { label: "Anime", laneVar: "var(--home-lane-anime)" },
  { label: "YouTube", laneVar: "var(--home-lane-yt)" },
] as const;

/** Server-rendered bento grid showcasing modes, registered providers, continuation, and recovery. */
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
        label="Three search modes"
        detail={byLabel.get("Three search modes")}
      >
        <div className="mt-6 flex flex-wrap items-center gap-2" aria-hidden="true">
          {MODES.map((mode, index) => (
            <span
              key={mode.label}
              style={withCssVars({ "--lane": mode.laneVar })}
              className={`kunai-mode-chip${index === 0 ? " is-primary" : ""}`}
            >
              <span className="kunai-lane-dot" />
              {mode.label}
            </span>
          ))}
          <kbd className="kunai-inline-kbd ml-1">Tab</kbd>
        </div>
        <div
          className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--home-hair)] pt-5 font-mono text-xs text-[var(--home-text-4)]"
          aria-hidden="true"
        >
          <span>/series · TMDB movies &amp; shows</span>
          <span>/anime · sub &amp; dub</span>
          <span>/youtube · direct stream</span>
        </div>
      </Tile>

      <Tile
        className="md:col-span-5"
        label="Direct providers"
        detail={byLabel.get("Direct providers")}
      >
        <p className="mt-5 flex items-baseline gap-3">
          <span className="font-sans text-5xl leading-none font-semibold text-[var(--home-text-1)] tabular-nums">
            {providers.length}
          </span>
          <span className="text-sm text-[var(--home-text-3)]">
            adapters, resolved on your machine
          </span>
        </p>
        <ul className="m-0 mt-5 flex list-none flex-wrap gap-1.5 p-0">
          {shown.map((name) => (
            <li
              key={name}
              className="rounded-md border border-[var(--home-hair-strong)] bg-[var(--home-well)] px-2 py-1 font-mono text-xs text-[var(--home-text-3)]"
            >
              {name}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="px-1 py-1 font-mono text-xs text-[var(--home-text-4)]">
              +{hidden} more
            </li>
          ) : null}
        </ul>
      </Tile>

      <Tile
        className="md:col-span-5"
        label="Continue watching"
        detail={byLabel.get("Continue watching")}
      >
        <ul className="m-0 mt-6 grid list-none grid-cols-2 gap-x-4 gap-y-3.5 p-0">
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
        <ol className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
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
    <section className={`kunai-bento-tile kunai-spotlight ${className ?? ""}`}>
      <h3 className="kunai-bento-tile__label m-0">{label}</h3>
      {detail ? (
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-pretty text-[var(--home-text-3)]">
          {detail}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Capability({ icon: Glyph, label }: { readonly icon: Icon; readonly label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm text-[var(--home-text-1)]">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--home-hair)] bg-[var(--home-raise-2)] text-[var(--home-lane-kunai)]">
        <Glyph className="size-4" stroke={1.5} />
      </span>
      {label}
    </li>
  );
}

function Step({ command, meaning }: { readonly command: string; readonly meaning: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <code className="rounded-md border border-[var(--home-hair-strong)] bg-[var(--home-well)] px-2 py-0.5 font-mono text-xs text-[var(--home-text-1)]">
        {command}
      </code>
      <span className="text-[var(--home-text-3)]">{meaning}</span>
    </li>
  );
}
