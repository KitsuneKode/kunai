"use client";

import { kunaiThemes } from "@/lib/themes";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useCoatCycler } from "./use-coat-cycler";

/** The orb's eclipse sweep — close to `--dur-panel` so it lands with the
 *  @property crossfade rather than long after it. */
const SWEEP_MS = 320;

/**
 * The coat cycler: a little orb that wears the site's accent and eclipses into
 * the next one on a press. It lives in fumadocs' `themeSwitch` slot, so it
 * shows up in the home nav's trailing controls and in the docs sidebar footer.
 *
 * Two animations happen on a press:
 *
 * - The orb itself does the toggles.dev eclipse — a mask circle slides across
 *   the old colour and carves it away to reveal the new one. Both fills come
 *   from the registry, so the sweep is exact while the page is mid-transition.
 * - The whole page does the skiper26 reveal through `useCoatCycler` —
 *   `startViewTransition` seeds the next coat's signature entrance from the
 *   orb. Browsers without the API get the @property crossfade instead, and
 *   reduced motion gets an instant swap.
 */
export function ThemeCycler({ className }: { readonly className?: string }) {
  const maskId = `theme-orb-mask-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { index, cycle } = useCoatCycler();
  // The coat the top circle still wears while the eclipse covers it.
  const [orbFrom, setOrbFrom] = useState(0);
  const [covering, setCovering] = useState(false);
  const sweepTimer = useRef<number | undefined>(undefined);

  // The hook mirrors `data-theme` into `index` — including coats the pull
  // cord changed — so the orb catches up here whenever it is not mid-eclipse.
  useEffect(() => {
    if (!covering) setOrbFrom(index);
    return () => window.clearTimeout(sweepTimer.current);
  }, [index, covering]);

  const press = useCallback(() => {
    window.clearTimeout(sweepTimer.current);
    const rect = buttonRef.current?.getBoundingClientRect();
    const next = cycle(
      rect ? rect.left + rect.width / 2 : undefined,
      rect ? rect.top + rect.height / 2 : undefined,
    );
    setOrbFrom(index);
    setCovering(true);
    sweepTimer.current = window.setTimeout(() => {
      setOrbFrom(next);
      setCovering(false);
    }, SWEEP_MS);
  }, [cycle, index]);

  const current = kunaiThemes[index] ?? kunaiThemes[0];
  const from = kunaiThemes[orbFrom] ?? kunaiThemes[0];

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={press}
      aria-label={`Kanna's coat: ${current.label}. Activate for the next one.`}
      title={`Kanna's coat: ${current.label}`}
      className={`kunai-theme-cycler text-fd-muted-foreground inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors${className ? ` ${className}` : ""}`}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <mask id={maskId}>
          <circle cx="12" cy="12" r="9" fill="white" />
          <circle
            cx={covering ? 12 : 34}
            cy={covering ? 12 : 0}
            r="10"
            fill="black"
            style={{
              transition: `cx ${SWEEP_MS}ms var(--ease-drawer), cy ${SWEEP_MS}ms var(--ease-drawer)`,
            }}
          />
        </mask>
        <circle cx="12" cy="12" r="9" fill={from.accent} mask={`url(#${maskId})`} />
        <circle cx="12" cy="12" r="9" fill={current.accent} />
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--kunai-line)" strokeWidth="1" />
      </svg>
    </button>
  );
}
