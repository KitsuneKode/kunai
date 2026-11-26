import type { ReactNode } from "react";
import React from "react";

import { footerKeySequence } from "./footer-key-sequence";
import { MouseTarget, usePressKey } from "./MouseRegions";

/**
 * Mouse for surfaces whose keys are the only input: a click presses the key a
 * row or chip names, through the surface's own `useInput`, so the click and
 * the key cannot disagree. Rows without a pressable key render unchanged.
 */
export function PressRow(props: {
  readonly id: string;
  /** A key hint as shown (`d`, `enter`, `⇧F`, …). */
  readonly keyHint: string;
  readonly children: ReactNode;
}) {
  const pressKey = usePressKey();
  const keys = rowKeySequence(props.keyHint);
  if (!pressKey || !keys) return <>{props.children}</>;
  return (
    <MouseTarget id={props.id} onClick={() => pressKey(keys)}>
      {props.children}
    </MouseTarget>
  );
}

/**
 * Select-then-activate for an arrow-navigated list (the Library gesture): a
 * click on another row presses ↑/↓ until it is highlighted, a click on the
 * highlighted row presses Enter, and the wheel moves one row. Used where the
 * list's index is the one ↑/↓ moves through.
 */
export function PickRow(props: {
  readonly id: string;
  readonly index: number;
  readonly selectedIndex: number;
  readonly children: ReactNode;
}) {
  const pressKey = usePressKey();
  if (!pressKey) return <>{props.children}</>;
  const { index, selectedIndex } = props;
  return (
    <MouseTarget
      id={props.id}
      onClick={() => {
        if (index === selectedIndex) return pressKey("\r");
        const step = index > selectedIndex ? "\x1b[B" : "\x1b[A";
        pressKey(step.repeat(Math.abs(index - selectedIndex)));
      }}
      onWheel={(direction) => pressKey(direction === "up" ? "\x1b[A" : "\x1b[B")}
    >
      {props.children}
    </MouseTarget>
  );
}

/**
 * A row's own key: for `↵ n` (Enter, or n) the letter, since Enter runs
 * whichever row is highlighted, not necessarily this one.
 */
export function rowKeySequence(keyHint: string): string | null {
  const tokens = keyHint.trim().split(/\s+/);
  const letter = tokens.toReversed().find((token) => [...token].length === 1 && token !== "↵");
  return footerKeySequence(letter ?? keyHint.trim());
}
