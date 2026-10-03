import { BentoRecovery } from "@/components/home/bento-recovery";
import { BentoStage, type StageMode } from "@/components/home/bento-stage";
import { BentoTile } from "@/components/home/bento-tile";
import type { HomeProviderMetadata } from "@/components/home/types";
import { codeMetadata } from "@/lib/code-metadata";
import { BENTO_MODES, CONTINUE_ITEMS, type BentoProvider } from "@/lib/home-bento";
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

/** Glyph per way back in, keyed by the command that opens it. */
const CONTINUE_GLYPH = new Map<string, Icon>([
  ["history", IconHistory],
  ["calendar", IconCalendarEvent],
  ["recommendation", IconSparkles],
  ["library", IconDownload],
]);

/**
 * What "everything stays one keystroke away" means, shown instead of listed.
 *
 * Four tiles of two sizes (7/5 over 5/7). Two of them are interactive and one
 * piece of state ties them together: pick a mode and the providers that search it
 * light up. A third lets you step through what the shell does when playback
 * stalls, and the fourth lists the ways back into what you were watching. The
 * interactive tiles are client components (`BentoStage`, `BentoRecovery`); this
 * stays a server component that looks every fact up (the command descriptions, the
 * provider list) and hands them down, so nothing on the page is typed twice and
 * every mode's panel is in the HTML for a crawler.
 */
export function HomeBento({ highlights, providers }: HomeBentoProps) {
  const byLabel = new Map(highlights.map((item) => [item.label, item.detail]));

  const modes: StageMode[] = BENTO_MODES.map((mode) => ({
    id: mode.id,
    label: mode.label,
    commandId: mode.commandId,
    alias: mode.alias,
    kinds: mode.kinds,
    slash: `/${mode.alias}`,
    description:
      codeMetadata.commands.find((command) => command.id === mode.commandId)?.description ?? "",
  }));

  // Recommended first, as the CLI offers them. The order is fixed so tiles do not
  // reshuffle as the mode changes; only their emphasis does.
  const stageProviders: BentoProvider[] = [...providers]
    .sort((a, b) => Number(b.recommended) - Number(a.recommended))
    .map((provider) => ({
      id: provider.id,
      name: provider.displayName,
      domain: provider.domain,
      kinds: provider.mediaKinds,
    }));

  return (
    <BentoStage
      modes={modes}
      providers={stageProviders}
      modesDetail={byLabel.get("Three catalog modes")}
      providersDetail={byLabel.get("Direct providers")}
      continueTile={
        <BentoTile
          className="md:col-span-5"
          label="Continue watching"
          detail={byLabel.get("Continue watching")}
        >
          <ul className="m-0 mt-6 grid list-none gap-3 p-0">
            {CONTINUE_ITEMS.map((item) => {
              const Glyph = CONTINUE_GLYPH.get(item.commandId) ?? IconHistory;
              return (
                <li
                  key={item.commandId}
                  className="text-fd-foreground flex items-center gap-2.5 text-sm"
                >
                  <span className="bg-fd-muted text-fd-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
                    <Glyph className="size-4" stroke={1.5} aria-hidden="true" />
                  </span>
                  {item.label}
                  <code className="text-fd-muted-foreground ml-auto rounded-md border border-[var(--kunai-line)] px-1.5 py-0.5 font-mono text-xs">
                    /{item.alias}
                  </code>
                </li>
              );
            })}
          </ul>
        </BentoTile>
      }
      recoveryTile={
        <BentoRecovery className="md:col-span-7" detail={byLabel.get("Recovery built in")} />
      }
    />
  );
}
