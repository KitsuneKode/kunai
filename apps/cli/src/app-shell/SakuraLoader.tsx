// =============================================================================
// SakuraLoader.tsx — the signature ❀ bloom loader + label shimmer
//
// The brand motif (❀ in rose, per .design/cli/kunai-sakura.html .petal/.empty)
// animated once and reused: a centered bloom flanked by drifting side petals,
// with a glimmer sweep across the active stage label. Color encodes state —
// rose `accent` in-flight, amber `warn` when stalled — never identity.
//
// Honors reduced-motion (static ❀, steady label) and a viewport-pause `active`
// prop, both delegated to the shared SakuraPetal frame primitives so there is
// one motion policy across the app.
// =============================================================================

import { Box, Text } from "ink";
import React from "react";

import {
  BLOOM_FRAMES,
  reducedMotionEnabled,
  STATIC_PETAL,
  useFrameTick,
} from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

const SHIMMER_INTERVAL_MS = 110;
const BLOOM_INTERVAL_MS = 150;
/** Side petals drift in/out on alternating beats around the center bloom. */
const SIDE_PETAL = "✿";

// ── Glimmer label ──────────────────────────────────────────────────────────
// A bright window sweeps left→right→left across the label; the rest sits in
// `muted`. With reduced motion the whole label is steady `text`.

export function GlimmerLabel({
  label,
  active,
  stalled,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly stalled: boolean;
}) {
  const chars = [...label];
  const span = Math.max(1, chars.length);
  const tick = useFrameTick(active, SHIMMER_INTERVAL_MS);
  const animate = active && !reducedMotionEnabled();
  const highlight = stalled ? palette.warn : palette.accent;

  if (!animate) {
    return (
      <Text color={stalled ? palette.warn : palette.text} bold>
        {label}
      </Text>
    );
  }

  // Ping-pong the bright index across the label so it sweeps back and forth.
  const cycle = span * 2 - 2 || 1;
  const pos = tick % cycle;
  const head = pos < span ? pos : cycle - pos;

  return (
    <Text>
      {chars.map((char, index) => {
        const distance = Math.abs(index - head);
        const color = distance === 0 ? highlight : distance === 1 ? palette.text : palette.muted;
        return (
          // eslint-disable-next-line react/no-array-index-key -- fixed label, stable order
          <Text key={`g-${index}`} color={color} bold={distance <= 1}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

// ── Bloom centerpiece ────────────────────────────────────────────────────────

export function SakuraBloom({
  active,
  stalled,
}: {
  readonly active: boolean;
  readonly stalled: boolean;
}) {
  const tick = useFrameTick(active, BLOOM_INTERVAL_MS);
  const animate = active && !reducedMotionEnabled();
  const frame = animate ? tick % BLOOM_FRAMES.length : 0;
  const center = animate ? (BLOOM_FRAMES[frame] ?? STATIC_PETAL) : STATIC_PETAL;
  const color = stalled ? palette.warn : palette.accent;
  // Side petals breathe in on alternating frames; hidden under reduced motion.
  const sideVisible = animate && frame % 2 === 0;
  const side = sideVisible ? SIDE_PETAL : " ";
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={palette.accentSoft}>{side} </Text>
      <Text color={color} bold>
        {center}
      </Text>
      <Text color={palette.accentSoft}> {side}</Text>
    </Box>
  );
}

// ── Block loader (bootstrap / resolve) ────────────────────────────────────────

export function SakuraLoader({
  label,
  sublabel,
  active = true,
  stalled = false,
}: {
  readonly label: string;
  readonly sublabel?: string;
  readonly active?: boolean;
  readonly stalled?: boolean;
}) {
  return (
    <Box flexDirection="row" alignItems="center" flexWrap="nowrap">
      <Box marginRight={2}>
        <SakuraBloom active={active} stalled={stalled} />
      </Box>
      <Box flexDirection="column">
        <GlimmerLabel label={label} active={active} stalled={stalled} />
        {sublabel ? <Text color={palette.muted}>{sublabel}</Text> : null}
      </Box>
    </Box>
  );
}

// ── Inline loader (browse search / overlay spinners) ──────────────────────────

export function InlineSakuraLoader({
  label,
  active = true,
  stalled = false,
}: {
  readonly label?: string;
  readonly active?: boolean;
  readonly stalled?: boolean;
}) {
  const tick = useFrameTick(active, BLOOM_INTERVAL_MS);
  const animate = active && !reducedMotionEnabled();
  const glyph = animate ? (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL) : STATIC_PETAL;
  const color = stalled ? palette.warn : palette.accent;
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={color} bold>
        {glyph}
      </Text>
      {label ? <Text color={palette.muted}> {label}</Text> : null}
    </Box>
  );
}
