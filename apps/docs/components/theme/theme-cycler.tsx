"use client";

import { DEFAULT_THEME_ID, kunaiThemes, THEME_STORAGE_KEY } from "@/lib/themes";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/** The orb's eclipse sweep — close to `--dur-panel` so it lands with the
 *  @property crossfade rather than long after it. */
const SWEEP_MS = 320;
/** How long the whole-page circle reveal takes to cover the viewport. */
const REVEAL_MS = 640;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
 * - The whole page does the skiper26 circle reveal — `startViewTransition`
 *   snapshots the new coat and a clip-path grows out from the button, so the
 *   next theme blooms outward from where you clicked. Browsers without the
 *   API (Firefox) get the @property crossfade instead, and reduced motion gets
 *   an instant swap.
 */
export function ThemeCycler({ className }: { readonly className?: string }) {
  const maskId = `theme-orb-mask-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [index, setIndex] = useState(0);
  // The coat the top circle still wears while the eclipse covers it.
  const [fromIndex, setFromIndex] = useState(0);
  const [covering, setCovering] = useState(false);
  const sweepTimer = useRef<number | undefined>(undefined);

  // First paint shows Sakura (the :root default); a stored coat then lands
  // without a React render flash — read it on mount and settle state once.
  useEffect(() => {
    const applied = document.documentElement.dataset.theme ?? DEFAULT_THEME_ID;
    const found = kunaiThemes.findIndex((theme) => theme.id === applied);
    if (found > 0) {
      setIndex(found);
      setFromIndex(found);
    }
    return () => window.clearTimeout(sweepTimer.current);
  }, []);

  const cycle = useCallback(() => {
    window.clearTimeout(sweepTimer.current);
    const next = (index + 1) % kunaiThemes.length;
    setFromIndex(index);
    setIndex(next);
    setCovering(true);

    const apply = () => {
      const id = kunaiThemes[next]?.id ?? DEFAULT_THEME_ID;
      if (id === DEFAULT_THEME_ID) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = id;
    };
    try {
      localStorage.setItem(THEME_STORAGE_KEY, kunaiThemes[next]?.id ?? DEFAULT_THEME_ID);
    } catch {
      // Private mode may refuse the write; the coat still applies for the visit.
    }

    if (!reducedMotion() && "startViewTransition" in document) {
      const rect = buttonRef.current?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : 64;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      document.startViewTransition(apply).ready.then(
        () => {
          document.documentElement.animate(
            {
              clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
            },
            {
              duration: REVEAL_MS,
              easing: "cubic-bezier(0.32, 0.72, 0, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        },
        () => {},
      );
    } else {
      apply();
    }

    sweepTimer.current = window.setTimeout(() => {
      setFromIndex(next);
      setCovering(false);
    }, SWEEP_MS);
  }, [index]);

  const current = kunaiThemes[index] ?? kunaiThemes[0]!;
  const from = kunaiThemes[fromIndex] ?? kunaiThemes[0]!;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={cycle}
      aria-label={`Kanna's coat: ${current.label}. Activate for the next one.`}
      title={`Kanna's coat: ${current.label}`}
      className={`kunai-theme-cycler text-fd-muted-foreground hover:text-fd-foreground inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors${className ? ` ${className}` : ""}`}
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
