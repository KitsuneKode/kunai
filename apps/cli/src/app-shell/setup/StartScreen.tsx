// Setup, screen one of two: what you watch, and whether this machine can play
//
// The one question that changes where Kunai starts, with the machine check
// reduced to a verdict line under it. The verdict follows the highlighted
// lane, so nobody is told about a dependency of a lane they are not choosing.
//
// Board: `.reference/design/cli/kunai-onboarding-v4.html`.

import { Box, Text } from "ink";
import React from "react";

import { reducedMotionEnabled } from "../motion-policy";
import { plainDependencyState, plainModeEnabled } from "../plain-mode";
import { BLOOM_FRAMES, STATIC_PETAL } from "../primitives/SakuraPetal";
import { palette } from "../shell-theme";
import type { SetupDensity, SetupVerdict, VerdictLine } from "./setup-verdict";
import { ChoiceRow, type FooterKey } from "./SetupFrame";
import { SetupTarget } from "./SetupPointer";
import { MODE_OPTIONS } from "./SetupScreens";

const SUB = {
  wide: "Sets where Kunai starts. Tab switches lanes any time.",
  narrow: "Sets where Kunai starts. Tab switches later.",
  tiny: null,
} satisfies Record<SetupDensity, string | null>;

const DEFAULTS_NOTE = {
  wide: [
    "Language, downloads and accounts start on their defaults.",
    "m sets them now · /setup changes them any time",
  ],
  narrow: [
    "Language, downloads and accounts keep their",
    "defaults · m sets them now · /setup later",
  ],
  tiny: [],
} satisfies Record<SetupDensity, readonly string[]>;

const GLYPH = { ok: "✓", warn: "△", blocked: "✗" } as const;
const PLAIN_STATE = { ok: "ok", warn: "degraded", blocked: "blocking" } as const;

function VerdictRow({ line, plain }: { readonly line: VerdictLine; readonly plain: boolean }) {
  if (line.kind === "command" || line.kind === "hint") {
    return (
      <Box paddingLeft={2}>
        <Text color={line.kind === "command" ? palette.accent : palette.muted}>{line.text}</Text>
      </Box>
    );
  }
  const color =
    line.kind === "ok" ? palette.ok : line.kind === "warn" ? palette.warn : palette.dangerText;
  return (
    <Box>
      <Text color={color} bold>
        {plain ? `${plainDependencyState(PLAIN_STATE[line.kind])} ` : `${GLYPH[line.kind]} `}
      </Text>
      <Text color={palette.text}>{line.text}</Text>
    </Box>
  );
}

export function StartScreen({
  selected,
  verdict,
  rechecking,
  tick,
  density,
}: {
  readonly selected: number;
  readonly verdict: SetupVerdict;
  readonly rechecking: boolean;
  readonly tick: number;
  readonly density: SetupDensity;
}) {
  const plain = plainModeEnabled();
  const tiny = density === "tiny";
  // The petal moves only while the probe runs; reduced motion keeps it still
  // and the sentence below carries the state.
  const petal =
    rechecking && !reducedMotionEnabled()
      ? (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL)
      : STATIC_PETAL;
  const showPetal = !plain && !tiny;
  const sub = SUB[density];
  // The note is the first thing to go: a third verdict line needs its rows.
  const note = density === "narrow" && verdict.lines.length > 2 ? [] : DEFAULTS_NOTE[density];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={tiny ? 0 : 1}>
        <Box>
          {showPetal ? (
            <Text color={rechecking ? palette.accent : palette.ok} bold>
              {`${petal}  `}
            </Text>
          ) : null}
          <Text color={palette.text} bold>
            What do you watch most?
          </Text>
        </Box>
        {sub ? (
          <Box paddingLeft={showPetal ? 3 : 0}>
            <Text color={palette.muted}>{sub}</Text>
          </Box>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {MODE_OPTIONS.map((option, i) => (
          <SetupTarget key={option.value} field="mode" value={String(i)}>
            <ChoiceRow
              label={option.label}
              detail={option.detail}
              selected={i === selected}
              hideDetail={tiny}
            />
          </SetupTarget>
        ))}
      </Box>

      <Box flexDirection="column">
        {rechecking ? (
          <Text color={palette.text}>Checking this machine again…</Text>
        ) : (
          verdict.lines.map((line) => <VerdictRow key={line.text} line={line} plain={plain} />)
        )}
      </Box>

      {note.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {note.map((line) => (
            <Text key={line} color={palette.dim}>
              {plain ? line.replaceAll(" · ", ", ") : line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** Footer for screen one. `r` leads when there is something to re-check. */
export function startFooter(input: {
  readonly attention: boolean;
  readonly density: SetupDensity;
}): readonly FooterKey[] {
  const tiny = input.density === "tiny";
  const machine: FooterKey = { key: "d", label: tiny ? "details" : "this machine" };
  if (input.attention) {
    return [
      { key: "r", label: "recheck" },
      { key: "enter", label: "continue" },
      { key: "↑↓", label: "choose" },
      ...(tiny ? [] : [machine, { key: "esc", label: "quit" }]),
    ];
  }
  return [
    { key: "enter", label: "continue" },
    { key: "↑↓", label: "choose" },
    machine,
    ...(tiny ? [] : [{ key: "m", label: "more setup" }]),
    { key: "esc", label: "quit" },
  ];
}

export const MACHINE_INTRO = {
  wide: "What Kunai found, and the one command for anything missing.",
  narrow: "What Kunai found, and the fix for the rest.",
  tiny: "What Kunai found here.",
} satisfies Record<SetupDensity, string>;

/** Footer while `d` shows the full machine table. */
export const MACHINE_FOOTER: readonly FooterKey[] = [
  { key: "d", label: "back" },
  { key: "r", label: "recheck" },
  { key: "↑↓", label: "choose" },
];
