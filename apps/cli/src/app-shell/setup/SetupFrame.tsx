// =============================================================================
// setup-frame.tsx — the Sakura shell frame, for setup
//
// Setup was the only surface in Kunai with no frame: no header, no surface
// label, no `[/] commands`. That, more than any copy, is why it read as a
// different application you left the shell to visit.
//
// `.reference/design/cli/kunai-sakura-systems.html` specified onboarding inside
// this frame from the start; `01-shell-footer-contract.md` gives the grammar:
//
//   🦊 Kunai · <context>                                        setup · N⁄7
//   <body — the current decision>
//   [key] label  [key] label                                         Setup
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import { companionMode } from "../companion-policy";
import { CompanionPet } from "../CompanionPet";
import { APP_LABEL, palette } from "../shell-theme";

export type FooterKey = { readonly key: string; readonly label: string };

/** Side padding the frame reserves, so screens can budget their own columns. */
export function setupGutter(width: number): number {
  return Math.max(2, Math.floor((width - Math.min(width, 84)) / 2) + 2);
}

/**
 * Columns a screen actually gets to draw in.
 *
 * Screens must budget against this rather than the terminal width. A row wider
 * than the content box does not truncate — Ink wraps it, which breaks column
 * alignment and inserts blank lines between rows.
 */
export function setupContentWidth(width: number): number {
  return Math.max(20, width - setupGutter(width) * 2);
}

/**
 * One progress fact, not two.
 *
 * The header bar carries `setup N⁄7`. An earlier draft also rendered a dot
 * strip under the body — the same fact twice on every screen, which is what
 * `00-principles.md` says not to do. The header count stays because it is
 * position plus destination ("3⁄7"); a second rendering added nothing.
 */

function FrameBar({
  width,
  left,
  right,
  top,
}: {
  readonly width: number;
  readonly left: React.ReactNode;
  readonly right: React.ReactNode;
  readonly top: boolean;
}) {
  return (
    <Box
      width={width}
      borderStyle="single"
      borderTop={!top}
      borderBottom={top}
      borderLeft={false}
      borderRight={false}
      borderColor={palette.line}
      paddingX={2}
      justifyContent="space-between"
    >
      {/* The left slot owns the squeeze: when its keys exceed the line they
          wrap inside this box instead of shoving the right label out of the
          frame. Without flexShrink here, a fifth key hint pushed "Setup" past
          the edge and Ink split it mid-word. */}
      <Box flexGrow={1} flexShrink={1}>
        {left}
      </Box>
      <Box flexShrink={0}>{right}</Box>
    </Box>
  );
}

export function FooterKeys({ parts }: { readonly parts: readonly FooterKey[] }) {
  return (
    <Box gap={1} flexWrap="wrap">
      {parts.map(({ key, label }, i) => (
        <React.Fragment key={key}>
          {i > 0 ? <Text color={palette.dim}> · </Text> : null}
          <Text color={palette.accent}>[{key}]</Text>
          <Text color={palette.muted}> {label}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

/**
 * The frame every setup screen wears.
 *
 * **Never set an explicit height here.** Setup mounts inside the app shell's
 * own box (`RetainedRootContentLayer` gives it `flexGrow: 1` and nothing else),
 * so the terminal's row count is not the space this frame gets — the shell
 * header, status row, and footer have already taken their share. Sizing to
 * `stdout.rows` made the frame taller than its container and pushed the footer
 * clean off the bottom of the screen, taking every key hint with it.
 * `.docs/design-system.md` states the rule: the width budget is owned by the
 * container, not the terminal.
 *
 * `flexGrow` lets the parent decide, which is correct at every terminal size.
 */
export function SetupFrame({
  width,
  context,
  step,
  totalSteps,
  footer,
  children,
}: {
  readonly width: number;
  readonly context: string;
  readonly step: number;
  readonly totalSteps: number;
  readonly footer: readonly FooterKey[];
  readonly children: React.ReactNode;
}) {
  const gutter = setupGutter(width);

  return (
    <Box flexDirection="column" width={width} flexGrow={1}>
      <FrameBar
        top
        width={width}
        left={
          <Text>
            <Text color={palette.text} bold>
              {APP_LABEL}
            </Text>
            <Text color={palette.dim}>{" · "}</Text>
            <Text color={palette.muted}>{context}</Text>
          </Text>
        }
        right={
          <Text>
            <Text color={palette.muted}>setup </Text>
            <Text color={palette.accent} bold>
              {step + 1}
            </Text>
            <Text color={palette.muted}>⁄{totalSteps}</Text>
          </Text>
        }
      />

      {/* flexGrow, never a fixed height — see the note on SetupFrame. Content
          sits a little above centre: dead-centre in a tall terminal leaves the
          top half looking abandoned, and the eye starts high. */}
      <Box flexDirection="column" width={width} flexGrow={1} paddingX={gutter} paddingTop={2}>
        {/* One pose for the whole wizard. Flipping it on the last step meant a
            fresh placement upload on a step transition, which is the one moment
            the pane is already re-laying out.

            The wrapper is conditional, not just the pet: a Box with a margin
            around a null child still lays out its margin, so `KUNAI_PET=off`
            left an empty row behind — which is not "retired entirely". */}
        {companionMode() === "off" ? null : (
          <Box marginBottom={1}>
            <CompanionPet pose="wait" rows={4} />
          </Box>
        )}
        {children}
      </Box>

      <FrameBar
        top={false}
        width={width}
        left={<FooterKeys parts={footer} />}
        right={<Text color={palette.dim}>Setup</Text>}
      />
    </Box>
  );
}

export function ScreenTitle({ text, sub }: { readonly text: string; readonly sub?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.text} bold>
        {text}
      </Text>
      {sub ? <Text color={palette.muted}>{sub}</Text> : null}
    </Box>
  );
}

/**
 * A selectable row: rose left rule plus an `accentFill` band, matching every
 * other Kunai surface (`design-system.md` — Shell UX Standard).
 */
export function ChoiceRow({
  label,
  detail,
  selected,
  badge,
}: {
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly badge?: string;
}) {
  return (
    <Box backgroundColor={selected ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Box flexDirection="column">
        <Text>
          <Text color={palette.text} bold={selected}>
            {label}
          </Text>
          {badge ? <Text color={palette.accent}>{`   ${badge}`}</Text> : null}
        </Text>
        <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
          {"  "}
          {detail}
        </Text>
      </Box>
    </Box>
  );
}

/** An on/off row for the toggle groups on the playback and accounts screens. */
export function ToggleRow({
  label,
  detail,
  on,
  selected,
  disabledNote,
  kind = "toggle",
}: {
  readonly label: string;
  readonly detail: string;
  readonly on: boolean;
  readonly selected: boolean;
  readonly disabledNote?: string;
  /**
   * A cycle row steps through values rather than turning on and off, so it must
   * not wear a filled toggle glyph — that reads as "enabled" for a row where
   * enabled is not a state it can be in.
   */
  readonly kind?: "toggle" | "cycle";
}) {
  const glyph = kind === "cycle" ? "↻ " : on ? "◉ " : "○ ";
  const glyphColor = kind === "cycle" ? palette.muted : on ? palette.ok : palette.dim;
  return (
    <Box backgroundColor={selected ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={glyphColor}>{glyph}</Text>
      <Box flexDirection="column">
        <Text color={palette.text} bold={selected}>
          {label}
        </Text>
        <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
          {"  "}
          {disabledNote ?? detail}
        </Text>
      </Box>
    </Box>
  );
}
