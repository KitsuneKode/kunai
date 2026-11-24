"use client";

import { SPRING_SETTLE, useHomeStage } from "@/components/home/home-stage-context";
import { withCssVars } from "@/lib/css-vars";
import type { HeroLane } from "@/lib/provider-sieve";
import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import { useEffect, useId } from "react";

type SceneCard = {
  readonly id: HeroLane;
  readonly label: string;
  readonly laneVar: string;
  readonly command: string;
  readonly lines: readonly [string, string, string];
};

const SCENE_CARDS: readonly SceneCard[] = [
  {
    id: "anime",
    label: "Anime",
    laneVar: "var(--home-lane-anime)",
    command: "/anime Frieren",
    lines: ["01 · Frieren · Ep 01–28", "HiAnime · 1080p HLS", "AniSkip chapters → mpv"],
  },
  {
    id: "series",
    label: "Series",
    laneVar: "var(--home-lane-series)",
    command: "/series Severance",
    lines: ["01 · Severance · S02E04", "VidLink · multi-sub", "Resume at 31:18 → mpv"],
  },
  {
    id: "movie",
    label: "Movies",
    laneVar: "var(--home-lane-movie)",
    command: "/series Dune",
    lines: ["01 · Dune: Part Two", "Rivestream · 1080p", "Direct handoff → mpv"],
  },
  {
    id: "youtube",
    label: "YouTube",
    laneVar: "var(--home-lane-yt)",
    command: "/youtube lofi radio",
    lines: ["01 · Lofi Girl · Live", "1080p + Opus audio", "Zero browser tabs → mpv"],
  },
];

const FAN_ROTATE = [-6, -2, 2, 6] as const;
const FAN_Y = [10, 2, 2, 10] as const;

/**
 * Perfolios-inspired fanned deck peeking above the hero headline.
 * Propagates the selected lane onto `.kunai-home` so the terminal stage beam follows it.
 */
export function HeroSceneRibbon() {
  const { activeLane, setActiveLane } = useHomeStage();
  const reduced = useReducedMotion();
  const groupId = useId();

  const activeIndex = SCENE_CARDS.findIndex((card) => card.id === activeLane);
  const activeCard = SCENE_CARDS[activeIndex] ?? SCENE_CARDS[0];

  useEffect(() => {
    const home = document.querySelector<HTMLElement>(".kunai-home");
    if (home && activeCard) {
      home.style.setProperty("--lane", activeCard.laneVar);
    }
  }, [activeCard]);

  const selectLane = (lane: HeroLane) => {
    setActiveLane(lane, { runDemo: true });
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="kunai-scene-ribbon">
        <div className="kunai-scene-deck" aria-hidden="true">
          {SCENE_CARDS.map((card, index) => {
            const isActive = card.id === activeLane;
            const distance = Math.abs(index - activeIndex);
            const restRotate = FAN_ROTATE[index] ?? 0;
            const restY = FAN_Y[index] ?? 6;

            return (
              <m.div
                key={card.id}
                onClick={() => selectLane(card.id)}
                className={`kunai-scene-card${isActive ? " is-active" : ""}`}
                style={withCssVars(
                  { "--lane": card.laneVar },
                  { zIndex: isActive ? 10 : 4 - distance },
                )}
                initial={false}
                animate={
                  reduced
                    ? {
                        rotate: isActive ? 0 : restRotate,
                        y: isActive ? -10 : restY,
                        scale: isActive ? 1.03 : 0.94,
                        opacity: isActive ? 1 : 0.56,
                      }
                    : {
                        rotate: isActive ? 0 : restRotate,
                        y: isActive ? -12 : restY,
                        scale: isActive ? 1.04 : 0.94,
                        opacity: isActive ? 1 : 0.54,
                      }
                }
                whileHover={
                  reduced || isActive ? undefined : { y: restY - 6, scale: 0.98, opacity: 0.85 }
                }
                transition={
                  reduced ? { duration: 0 } : { ...SPRING_SETTLE, delay: distance * 0.025 }
                }
              >
                <span className="kunai-scene-card__bar" />
                <div className="kunai-scene-card__top">
                  <span className="kunai-scene-card__dot" />
                  <span className="kunai-scene-card__cmd">{card.command}</span>
                </div>
                <div className="kunai-scene-card__body">
                  {card.lines.map((line, lineIdx) => (
                    <span
                      key={line}
                      className={
                        lineIdx === 0
                          ? "kunai-scene-card__line kunai-scene-card__line--title"
                          : lineIdx === 2
                            ? "kunai-scene-card__line kunai-scene-card__line--accent"
                            : "kunai-scene-card__line"
                      }
                    >
                      {line}
                    </span>
                  ))}
                </div>
              </m.div>
            );
          })}
        </div>

        <fieldset className="kunai-scene-pill m-0 border-0" aria-label="Preview search mode">
          <legend className="sr-only">Preview search mode</legend>
          <span className="kunai-scene-pill__hint" aria-hidden="true">
            <kbd>Tab</kbd>
          </span>
          {SCENE_CARDS.map((card) => {
            const isSelected = card.id === activeLane;
            return (
              <label
                key={card.id}
                className={`kunai-scene-pill__btn${isSelected ? " is-selected" : ""}`}
                style={withCssVars({ "--lane": card.laneVar })}
              >
                <input
                  type="radio"
                  name={`hero-lane-${groupId}`}
                  value={card.id}
                  checked={isSelected}
                  onChange={() => selectLane(card.id)}
                  aria-label={`${card.label} mode`}
                  className="sr-only"
                />
                {isSelected ? <span className="kunai-scene-pill__indicator" /> : null}
                <span className="kunai-scene-pill__dot" aria-hidden="true" />
                <span className="relative z-[1]">{card.label}</span>
              </label>
            );
          })}
        </fieldset>
      </div>
    </LazyMotion>
  );
}
