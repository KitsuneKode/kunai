"use client";

import { BentoTile } from "@/components/home/bento-tile";
import {
  cycleMode,
  DEFAULT_BENTO_MODE,
  servesMode,
  type BentoMode,
  type BentoModeId,
  type BentoProvider,
} from "@/lib/home-bento";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/** A mode with the words the server looked up for it. */
export type StageMode = BentoMode & {
  /** `/series`, `/anime`, `/youtube`. */
  readonly slash: string;
  /** What the command does, in the CLI's own words. */
  readonly description: string;
};

type BentoStageProps = {
  readonly modes: readonly StageMode[];
  readonly providers: readonly BentoProvider[];
  readonly modesDetail: string | undefined;
  readonly providersDetail: string | undefined;
  /** The tiles that need no state, rendered on the server and placed in the grid. */
  readonly continueTile: ReactNode;
  readonly recoveryTile: ReactNode;
};

/**
 * The interactive half of the home bento.
 *
 * Pick a mode in the first tile and the second answers: the providers that search
 * that mode light up and the rest dim. The two tiles share one piece of state, so
 * the section is one demonstration (which mode, and who serves it) rather than two
 * unrelated widgets. Every mode's panel is in the server HTML with `hidden` on the
 * inactive ones, so a crawler and a visitor without JavaScript read all three.
 *
 * The modes are a real tablist: arrow keys move between them, Home and End jump to
 * the ends, and only the selected tab is in the tab order. The `Tab` key itself
 * cannot be taken over on a web page, so the `Tab` keycap is a button that does what
 * the key does in Kunai: cycle to the next mode.
 *
 * The spotlight is a pointer glow that follows the cursor across whichever tile it
 * is on. It is set as two CSS variables on that tile, with no React state, so
 * moving the pointer never renders anything. Touch has no hover and is ignored.
 */
export function BentoStage({
  modes,
  providers,
  modesDetail,
  providersDetail,
  continueTile,
  recoveryTile,
}: BentoStageProps) {
  const [modeId, setModeId] = useState<BentoModeId>(DEFAULT_BENTO_MODE);
  const tabs = useRef(new Map<BentoModeId, HTMLButtonElement>());
  const spot = useRef<HTMLElement | null>(null);
  const ids = useId();

  const active = modes.find((mode) => mode.id === modeId) ?? modes[0];
  if (!active) return null;
  const serving = providers.filter((provider) => servesMode(provider, active));

  const select = (id: BentoModeId, focus = false) => {
    setModeId(id);
    if (focus) tabs.current.get(id)?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = modes.at(-1);
    const first = modes[0];
    if (event.key === "ArrowRight") select(cycleMode(modeId, 1), true);
    else if (event.key === "ArrowLeft") select(cycleMode(modeId, -1), true);
    else if (event.key === "Home" && first) select(first.id, true);
    else if (event.key === "End" && last) select(last.id, true);
    else return;
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    const tile = target?.closest<HTMLElement>("[data-bento-tile]") ?? null;
    if (tile !== spot.current) {
      spot.current?.removeAttribute("data-spot");
      spot.current = tile;
      tile?.setAttribute("data-spot", "true");
    }
    if (!tile) return;
    const box = tile.getBoundingClientRect();
    tile.style.setProperty("--mx", `${Math.round(event.clientX - box.left)}px`);
    tile.style.setProperty("--my", `${Math.round(event.clientY - box.top)}px`);
  };

  const onPointerLeave = () => {
    spot.current?.removeAttribute("data-spot");
    spot.current = null;
  };

  return (
    <div
      className="kunai-bento grid grid-cols-1 gap-4 md:grid-cols-12"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <BentoTile className="md:col-span-7" label="Three catalog modes" detail={modesDetail}>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Catalog mode"
            className="flex flex-wrap items-center gap-2"
          >
            {modes.map((mode) => {
              const selected = mode.id === modeId;
              return (
                <button
                  key={mode.id}
                  ref={(node) => {
                    if (node) tabs.current.set(mode.id, node);
                    else tabs.current.delete(mode.id);
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${mode.id}`}
                  aria-selected={selected}
                  aria-controls={`${ids}-panel-${mode.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(mode.id)}
                  onKeyDown={onTabKeyDown}
                  className={`focus-visible:ring-ring rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] outline-none focus-visible:ring-2 active:scale-[0.97] ${
                    selected
                      ? "border-[var(--kunai-accent-deep)] bg-[color-mix(in_oklab,var(--kunai-accent)_12%,transparent)] text-[var(--kunai-accent)]"
                      : "text-fd-muted-foreground hover:text-fd-foreground border-[var(--kunai-line)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_40%,transparent)]"
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => select(cycleMode(modeId))}
            aria-label="Tab: switch to the next mode"
            className="border-fd-border bg-fd-card text-fd-muted-foreground hover:text-fd-foreground focus-visible:ring-ring ml-1 rounded-md border px-2 py-1 font-mono text-xs transition-[color,transform] duration-150 ease-[var(--ease-out)] outline-none focus-visible:ring-2 active:translate-y-px active:scale-[0.96]"
          >
            Tab
          </button>
        </div>

        {modes.map((mode) => (
          <div
            key={mode.id}
            role="tabpanel"
            id={`${ids}-panel-${mode.id}`}
            aria-labelledby={`${ids}-tab-${mode.id}`}
            hidden={mode.id !== modeId}
            className="kunai-bento-panel mt-5 flex flex-col gap-2"
          >
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <code className="text-fd-foreground rounded-md border border-[var(--kunai-line)] px-2 py-0.5 font-mono text-xs">
                {mode.slash}
              </code>
              <span className="text-fd-muted-foreground">{mode.description}</span>
            </p>
          </div>
        ))}
      </BentoTile>

      <BentoTile className="md:col-span-5" label="Direct providers" detail={providersDetail}>
        <p className="mt-5 flex items-baseline gap-3">
          <span className="text-fd-foreground font-sans text-5xl leading-none font-semibold tabular-nums">
            {providers.length}
          </span>
          <span className="text-fd-muted-foreground text-sm">
            adapters, resolved on your machine
          </span>
        </p>
        <p aria-live="polite" className="text-fd-muted-foreground m-0 mt-3 text-sm">
          <span className="text-fd-primary font-medium tabular-nums">{serving.length}</span> of{" "}
          {providers.length} search {active.label.toLowerCase()}
        </p>
        <ul className="m-0 mt-4 flex list-none flex-wrap gap-1.5 p-0">
          {providers.map((provider) => {
            const lit = servesMode(provider, active);
            return (
              <li
                key={provider.id}
                title={provider.domain}
                data-lit={lit}
                className={`rounded-md border px-2 py-1 font-mono text-xs transition-[opacity,border-color,color,background-color] duration-200 ease-[var(--ease-out)] ${
                  lit
                    ? "text-fd-foreground border-[var(--kunai-accent-deep)] bg-[color-mix(in_oklab,var(--kunai-accent)_9%,transparent)]"
                    : "text-fd-muted-foreground border-[var(--kunai-line)] opacity-45"
                }`}
              >
                {provider.name}
                {lit ? (
                  <span className="sr-only"> (searches {active.label.toLowerCase()})</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </BentoTile>

      {continueTile}
      {recoveryTile}
    </div>
  );
}
