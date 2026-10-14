"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCoatCycler } from "./use-coat-cycler";

/**
 * Kanna's pull cord — a ceiling cord hanging from the top-right chrome that
 * cycles Kanna's coats when you yank it, after FeralUI's PullCord. The rope
 * is a real Verlet sim: 16 point masses relaxed against distance constraints,
 * so it hangs, swings and settles under gravity rather than playing a canned
 * arc. The switch is a detent, not a timer — pull the rope taut and the mount
 * plunger pays out travel until it trips mid-pull, then has to re-seat before
 * it can fire again. Rope and knob take `--color-fd-primary`, so the cord
 * wears the coat it is about to change. Reduced motion hangs it straight.
 */

const NODES = 16;
const SEGMENT = 9; // px between masses — ~135px of rope
const DETENT = 16; // px of plunger travel that trips the switch
const RESEAT = 4; // sag below this re-arms the detent
const GRAVITY = 2400; // px/s²
const DAMPING = 0.985;
const RELAX = 8; // constraint passes per step — keeps the rope inextensible
const MOUNT_X = 24; // mount point inside the 48px viewbox
const ROPE_LENGTH = (NODES - 1) * SEGMENT;
const VIEWBOX = 48;
const PLUNGER_SPRING = 26; // 1/s — how fast the mount snaps home after fire

/** Typed-array read with strict indexing — bounds are fixed by NODES, so the
 *  fallback never fires, but it keeps the sim honest without `!` asserts. */
const at = (a: Float64Array, i: number): number => a[i] ?? 0;

export function PullCord() {
  const { cycle } = useCoatCycler();
  const pathRef = useRef<SVGPathElement | null>(null);
  const knobRef = useRef<SVGGElement | null>(null);
  const heldRef = useRef(false);
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const x = new Float64Array(NODES).fill(MOUNT_X);
    const y = new Float64Array(NODES);
    const px = new Float64Array(NODES).fill(MOUNT_X);
    const py = new Float64Array(NODES);
    for (let i = 0; i < NODES; i++) y[i] = py[i] = i * SEGMENT;

    let armed = true;
    let sag = 0;
    let knobX = MOUNT_X;
    let knobY = ROPE_LENGTH;
    let raf = 0;
    let last = performance.now();
    let posted = "";
    let postedKnob = "";

    const fire = () => {
      armed = false;
      // Bloom the next coat out from the knob's viewport position.
      const svg = pathRef.current?.ownerSVGElement?.getBoundingClientRect();
      const scale = svg ? svg.width / VIEWBOX : 1;
      cycleRef.current(
        svg ? svg.left + at(x, NODES - 1) * scale : undefined,
        svg ? svg.top + at(y, NODES - 1) * scale : undefined,
      );
    };

    const write = () => {
      let d = `M ${at(x, 0).toFixed(1)} ${at(y, 0).toFixed(1)}`;
      for (let i = 1; i < NODES - 1; i++) {
        const mx = (at(x, i) + at(x, i + 1)) / 2;
        const my = (at(y, i) + at(y, i + 1)) / 2;
        d += ` Q ${at(x, i).toFixed(1)} ${at(y, i).toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      d += ` L ${at(x, NODES - 1).toFixed(1)} ${at(y, NODES - 1).toFixed(1)}`;
      if (d !== posted) {
        pathRef.current?.setAttribute("d", d);
        posted = d;
      }
      const t = `translate(${at(x, NODES - 1).toFixed(1)} ${at(y, NODES - 1).toFixed(1)})`;
      if (t !== postedKnob) {
        knobRef.current?.setAttribute("transform", t);
        postedKnob = t;
      }
    };

    const step = (dt: number) => {
      // The mount plunger: while held the pointer carries the knob and pull
      // beyond the rope's length is paid out as sag; while free the plunger
      // springs home and the rope settles under gravity.
      if (heldRef.current) {
        const tipY = Math.max(sag + ROPE_LENGTH, knobY);
        x[NODES - 1] = knobX;
        y[NODES - 1] = tipY;
        sag = Math.min(DETENT, Math.max(0, tipY - ROPE_LENGTH));
        if (armed && sag >= DETENT) fire();
      } else {
        sag += (0 - sag) * Math.min(1, PLUNGER_SPRING * dt);
        if (sag < RESEAT) armed = true;
      }

      x[0] = px[0] = MOUNT_X;
      y[0] = py[0] = sag;

      const g = GRAVITY * dt * dt;
      for (let i = 1; i < NODES; i++) {
        const nx = at(x, i);
        const ny = at(y, i);
        x[i] = nx + (nx - at(px, i)) * DAMPING;
        y[i] = ny + (ny - at(py, i)) * DAMPING + g;
        px[i] = nx;
        py[i] = ny;
      }
      if (heldRef.current) {
        x[NODES - 1] = knobX;
        y[NODES - 1] = Math.max(sag + ROPE_LENGTH, knobY);
      }
      for (let pass = 0; pass < RELAX; pass++) {
        x[0] = MOUNT_X;
        y[0] = sag;
        for (let i = 0; i < NODES - 1; i++) {
          const dx = at(x, i + 1) - at(x, i);
          const dy = at(y, i + 1) - at(y, i);
          const d = Math.hypot(dx, dy) || 1e-6;
          const k = ((d - SEGMENT) / d) * 0.5;
          const kx = dx * k;
          const ky = dy * k;
          if (i === 0) {
            x[i + 1] = at(x, i + 1) - kx * 2;
            y[i + 1] = at(y, i + 1) - ky * 2;
          } else {
            x[i] = at(x, i) + kx;
            y[i] = at(y, i) + ky;
            x[i + 1] = at(x, i + 1) - kx;
            y[i + 1] = at(y, i + 1) - ky;
          }
        }
      }
      write();
    };

    const onMove = (event: PointerEvent) => {
      if (!heldRef.current) return;
      const svg = pathRef.current?.ownerSVGElement?.getBoundingClientRect();
      if (!svg) return;
      const scale = svg.width / VIEWBOX;
      knobX = (event.clientX - svg.left) / scale;
      knobY = (event.clientY - svg.top) / scale;
      if (reduce) {
        // Straight cord, no swing — drag stretches, detent still trips.
        const tipY = Math.max(ROPE_LENGTH, knobY);
        x[NODES - 1] = MOUNT_X;
        y[NODES - 1] = tipY;
        if (armed && tipY >= ROPE_LENGTH + DETENT) fire();
        for (let i = 0; i < NODES; i++) {
          x[i] = MOUNT_X;
          y[i] = (tipY * i) / (NODES - 1);
        }
        write();
      }
    };
    const onUp = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      setPulling(false);
      if (reduce) {
        armed = true;
        for (let i = 0; i < NODES; i++) {
          x[i] = MOUNT_X;
          y[i] = i * SEGMENT;
        }
        write();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    if (reduce) {
      for (let i = 0; i < NODES; i++) {
        x[i] = MOUNT_X;
        y[i] = i * SEGMENT;
      }
      write();
    } else {
      const frame = (now: number) => {
        const dt = Math.min(1 / 30, (now - last) / 1000);
        last = now;
        step(dt);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // The sim runs once; the coat cycler is reached through cycleRef.
  }, []);

  // Docs pages have a right-hand TOC column the cord would dangle across —
  // it stays on the home-shell surfaces, where the right edge is open.
  const pathname = usePathname();

  const grab = useCallback((event: React.PointerEvent<SVGGElement>) => {
    heldRef.current = true;
    setPulling(true);
    event.preventDefault();
  }, []);
  // Keyboard and AT pull: a real button that stays screen-reader-sized until
  // it takes focus, then appears under the knob.
  const buttonPull = useCallback(() => {
    const svg = knobRef.current?.ownerSVGElement?.getBoundingClientRect();
    cycleRef.current(
      svg ? svg.left + (svg.width / VIEWBOX) * MOUNT_X : undefined,
      svg ? svg.top + ROPE_LENGTH : undefined,
    );
  }, []);

  if (pathname?.startsWith("/docs")) return null;

  return (
    <div className="pointer-events-none fixed end-3 inset-bs-0 z-[35] hidden sm:end-6 sm:block">
      <svg
        aria-hidden="true"
        className="block h-[210px] w-12 select-none"
        viewBox="0 0 48 220"
        style={{ touchAction: "none" }}
      >
        <path
          ref={pathRef}
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          d={`M ${MOUNT_X} 0 L ${MOUNT_X} ${ROPE_LENGTH}`}
          opacity={0.9}
        />
        <g
          ref={knobRef}
          transform={`translate(${MOUNT_X} ${ROPE_LENGTH})`}
          onPointerDown={grab}
          style={{ cursor: pulling ? "grabbing" : "grab", pointerEvents: "auto" }}
        >
          <title>Pull to change Kanna&apos;s coat</title>
          {/* Generous hit area — the grab target is bigger than the bead. */}
          <circle r="16" fill="transparent" />
          <circle r="7" fill="var(--color-fd-primary)" stroke="var(--kunai-bg)" strokeWidth="2" />
          {/* The orbit label — a slow ring of type around the knob, after
              chanhdai's spinning circular text. It rides inside the knob
              group, so it swings with the rope. */}
          <g className="kunai-cord-orbit" aria-hidden="true">
            <defs>
              <path id="kunai-cord-orbit-path" d="M -12 0 A 12 12 0 1 1 12 0 A 12 12 0 1 1 -12 0" />
            </defs>
            <text fontSize="4.6" fill="var(--color-fd-primary)" opacity="0.85">
              <textPath href="#kunai-cord-orbit-path">pull me · pull me · </textPath>
            </text>
          </g>
        </g>
      </svg>
      <button
        type="button"
        onClick={buttonPull}
        className="text-fd-muted-foreground bg-fd-card border-fd-border sr-only w-28 rounded-md border px-2 py-1 text-xs focus:not-sr-only"
      >
        Change Kanna&apos;s coat
      </button>
    </div>
  );
}
