"use client";

import { SPRING_SETTLE } from "@/components/home/home-stage-context";
import { domAnimation, LazyMotion, m, useInView, useReducedMotion } from "motion/react";
import { useRef, useSyncExternalStore } from "react";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

const noopSubscribe = () => () => {};
/** False in server HTML and during hydration, true once the client has taken over. */
const useEnhanced = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

type OdometerProps = {
  readonly value: number;
  readonly className?: string;
  readonly format?: boolean;
};

/**
 * Rolling slot-machine digit reels (kshv.me / Skiper style).
 * Renders the exact count as plain digits until the client hydrates, keeps it in an
 * accessible span for assistive tech, and falls back cleanly under `prefers-reduced-motion`.
 */
export function Odometer({ value, className, format = true }: OdometerProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(hostRef, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  // Server HTML and no-JS visitors see the real count; reels start at 0 and
  // would otherwise read "0,000" until the client rolls them.
  const enhanced = useEnhanced();

  const formatted = format ? new Intl.NumberFormat("en-US").format(value) : String(value);
  const rawChars = [...formatted];
  const digitCount = rawChars.filter((char) => char >= "0" && char <= "9").length;

  let seenDigits = 0;
  const slots = rawChars.map((char, pos) => {
    const numeric = char >= "0" && char <= "9" ? Number(char) : null;
    const placeFromRight = rawChars.length - 1 - pos;
    const rightDigitIndex = numeric !== null ? digitCount - 1 - seenDigits++ : -1;
    return {
      key: numeric !== null ? `place-${placeFromRight}` : `sep-${placeFromRight}-${char}`,
      char,
      numeric,
      delay: rightDigitIndex >= 0 ? rightDigitIndex * 0.04 : 0,
    };
  });

  return (
    <LazyMotion features={domAnimation}>
      <span
        ref={hostRef}
        className={`kunai-odometer inline-flex items-baseline tabular-nums ${className ?? ""}`}
      >
        <span className="sr-only">{formatted}</span>
        <span aria-hidden="true" className="inline-flex items-baseline">
          {slots.map((slot) => {
            if (slot.numeric === null || reduced || !enhanced) {
              return (
                <span key={slot.key} className="inline-block">
                  {slot.char}
                </span>
              );
            }

            return (
              <span
                key={slot.key}
                className="relative inline-block h-[1em] overflow-hidden align-baseline leading-none"
              >
                <m.span
                  className="flex flex-col leading-none"
                  initial={{ y: "0em" }}
                  animate={{ y: inView ? `${-slot.numeric}em` : "0em" }}
                  transition={{ ...SPRING_SETTLE, delay: slot.delay }}
                >
                  {DIGITS.map((digit) => (
                    <span key={digit} className="block h-[1em] leading-none">
                      {digit}
                    </span>
                  ))}
                </m.span>
              </span>
            );
          })}
        </span>
      </span>
    </LazyMotion>
  );
}
