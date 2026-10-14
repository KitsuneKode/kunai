"use client";

import * as React from "react";

import { IsoFigure } from "../react/draw";
import { asksForStillness, useReadout } from "../react/live";
import { needleAt, plungerShift, springAt, tokenShift, SCREEN_ART } from "./geometry";
import { CYCLE, countsOf, frameOf, readoutOf } from "./rig";
import { HEIGHT, PLUNGER_HOME, WIDTH } from "./view";

const MOST_DT = 1 / 30;

interface Nodes {
  token: SVGGElement | null;
  plunger: SVGGElement | null;
  spring: SVGPathElement | null;
  needle: SVGPathElement | null;
  glow: SVGPathElement | null;
}

interface Props {
  label: string;
  children: React.ReactNode;
  token: React.ReactNode;
  plunger: React.ReactNode;
}

/*
 * The gate never stops: while the figure is on screen it feeds candidates
 * through a duty cycle — travel, stamp, judge, route. Everything reads from
 * `frameOf(clock)`, so the still and the moving figure always agree, and the
 * readout counts what the reader actually watched happen. Reduced motion
 * keeps the cycle but snaps each transition instead of easing it.
 */
export function ResolveGateLive({ label, children, token, plunger }: Props) {
  const { anchor, say } = useReadout<HTMLDivElement>();
  const root = React.useRef<HTMLDivElement | null>(null);
  const nodes = React.useRef<Nodes>({
    token: null,
    plunger: null,
    spring: null,
    needle: null,
    glow: null,
  });
  const clock = React.useRef(0);
  const frame = React.useRef(0);
  const last = React.useRef(0);
  const [running, setRunning] = React.useState(false);
  // The figure animates while it sits in view — WCAG 2.2.2 asks for a way to
  // pause that, and this is it. Pausing freezes the loop mid-pose; the readout
  // keeps the counts it had when the motion stopped.
  const [paused, setPaused] = React.useState(false);

  const draw = React.useCallback(
    (calm: boolean) => {
      const pose = frameOf(
        calm ? Math.round(clock.current / CYCLE) * CYCLE + CYCLE * 0.55 : clock.current,
      );
      nodes.current.token?.setAttribute("transform", tokenShift(pose.tokenX, pose.tipSide));
      nodes.current.plunger?.setAttribute("transform", plungerShift(pose.plunger));
      nodes.current.spring?.setAttribute("d", springAt(pose.plunger));
      nodes.current.needle?.setAttribute("d", needleAt(pose.needle));
      nodes.current.glow?.setAttribute("fill-opacity", `${0.08 + pose.glow * 0.75}`);
      nodes.current.glow?.setAttribute("stroke-opacity", `${0.25 + pose.glow * 0.75}`);
      say(readoutOf(countsOf(clock.current)));
    },
    [say],
  );

  const stop = React.useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const run = React.useCallback(() => {
    if (frame.current) return;
    last.current = 0;
    const tick = (now: number) => {
      const dt = last.current ? Math.min((now - last.current) / 1000, MOST_DT) : 1 / 60;
      last.current = now;
      const calm = asksForStillness();
      clock.current += calm ? dt * 2.2 : dt; // calm viewers get the verdicts sooner
      draw(calm);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw]);

  React.useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setRunning(Boolean(entries.at(-1)?.isIntersecting)),
      {
        rootMargin: "80px 0px",
      },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [stop]);

  React.useEffect(() => {
    if (running && !paused) {
      run();
      return stop;
    }
    stop();
  }, [running, paused, run, stop]);

  /* First paint before the loop starts: rest pose, zeroed counters. */
  React.useEffect(() => draw(false), [draw]);

  const bind =
    <K extends keyof Nodes>(key: K) =>
    (node: Nodes[K]) => {
      nodes.current[key] = node;
    };

  const rest = frameOf(0);

  return (
    <div
      ref={(node) => {
        root.current = node;
        anchor.current = node;
      }}
      className="rg-live"
    >
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        {children}
        <path
          ref={bind("glow")}
          className="rg-glow"
          d={SCREEN_ART.glow}
          fill="var(--anatomy-green)"
          fillOpacity={0.08}
        />
        <g>
          <path
            ref={bind("spring")}
            className="iso-line rg-spring"
            data-tone="mid"
            d={springAt(PLUNGER_HOME)}
            fill="none"
          />
        </g>
        <g ref={bind("plunger")} transform={plungerShift(rest.plunger)}>
          {plunger}
        </g>
        <g ref={bind("token")} transform={tokenShift(rest.tokenX, 0)}>
          {token}
        </g>
        <g>
          <path
            ref={bind("needle")}
            className="iso-line rg-needle"
            data-tone="lit"
            d={needleAt(rest.needle)}
          />
        </g>
      </IsoFigure>
      <button
        type="button"
        className="rg-pause"
        aria-pressed={paused}
        aria-label={
          paused ? "Resume the resolve gate animation" : "Pause the resolve gate animation"
        }
        onClick={() => setPaused((was) => !was)}
      >
        {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
