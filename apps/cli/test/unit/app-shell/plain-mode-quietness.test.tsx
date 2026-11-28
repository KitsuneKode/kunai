import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import { LoadingShell } from "@/app-shell/loading-shell";
import {
  plainPlaceholder,
  plainTimerAllowed,
  setPlainModePreferenceSource,
  shouldSuppressRedraw,
} from "@/app-shell/plain-mode";
import { fallbackCommandState } from "@/app-shell/shell-command-model";

import { simulateTicks } from "../../harness/render-capture";
import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

const TIMER = /\b(?:setTimeout|setInterval)\s*\(/;
const POLICY = /plainTimerAllowed\(\s*"(?:decorative|functional)"/;
const MOTION_GATE = /\breducedMotionEnabled\s*\(/;

/**
 * Timers that update real state (search, resize, persist, polls) and animation
 * already stopped by reduced motion. A new file with a timer must call
 * `plainTimerAllowed` or sit here with a reason. Decorative callers are not
 * listed: they have to call `plainTimerAllowed("decorative")`.
 */
const FUNCTIONAL_OR_MOTION_TIMERS: ReadonlyMap<string, string> = new Map([
  ["apps/cli/src/app-shell/checklist-shell.tsx", "confirm delay before submit"],
  ["apps/cli/src/app-shell/download-status-monitor.ts", "download progress poll"],
  ["apps/cli/src/app-shell/exit-shell.tsx", "exit fade already gated by reduced motion"],
  ["apps/cli/src/app-shell/hooks/use-calendar-now.ts", "wall-clock minute refresh"],
  ["apps/cli/src/app-shell/hooks/use-dwell-prefetch.ts", "dwell delay before prefetch"],
  ["apps/cli/src/app-shell/hooks/use-search-suggestions.ts", "debounce before suggestions"],
  ["apps/cli/src/app-shell/hooks/use-settled-value.ts", "debounce a rapidly changing value"],
  [
    "apps/cli/src/app-shell/ink-shell.tsx",
    "event notices and presence poll, not an idle frame loop",
  ],
  ["apps/cli/src/app-shell/mouse/mouse-stdin.ts", "coalesce a partial mouse report"],
  ["apps/cli/src/app-shell/pickers/list-shell.tsx", "confirm delay before submit"],
  ["apps/cli/src/app-shell/playback-mount-shell.tsx", "playback position poll"],
  ["apps/cli/src/app-shell/primitives/LoadingState.tsx", "spinner gated by reduced motion"],
  ["apps/cli/src/app-shell/primitives/SakuraPetal.tsx", "petal frames gated by reduced motion"],
  ["apps/cli/src/app-shell/sixel-overlay.ts", "flush a queued sixel paint"],
  ["apps/cli/src/app-shell/use-poster-preview.ts", "poster fetch debounce"],
  ["apps/cli/src/app-shell/use-viewport-policy.ts", "debounce terminal resize"],
]);

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function auditPlainTimers(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of sources) {
    const code = codeWithoutComments(source);
    if (!TIMER.test(code)) continue;
    if (POLICY.test(code) || MOTION_GATE.test(code)) continue;
    const reason = FUNCTIONAL_OR_MOTION_TIMERS.get(file);
    if (reason !== undefined && reason.trim().length > 0) continue;
    violations.push(
      `${file} (timer without plainTimerAllowed("decorative" | "functional") or reducedMotionEnabled)`,
    );
  }
  return violations;
}

let savedPlain: string | undefined;

beforeEach(() => {
  savedPlain = process.env.KUNAI_PLAIN;
});

afterEach(() => {
  setPlainModePreferenceSource(() => false);
  if (savedPlain === undefined) delete process.env.KUNAI_PLAIN;
  else process.env.KUNAI_PLAIN = savedPlain;
});

describe("plain quiet policy", () => {
  test("decorative timers stop in plain mode and functional timers do not", () => {
    expect(plainTimerAllowed("decorative", true)).toBe(false);
    expect(plainTimerAllowed("decorative", false)).toBe(true);
    expect(plainTimerAllowed("functional", true)).toBe(true);
    expect(shouldSuppressRedraw(true)).toBe(true);
    expect(shouldSuppressRedraw(false)).toBe(false);
    expect(plainPlaceholder("Breaking Bad", true)).toBe("(empty, e.g. Breaking Bad)");
    expect(plainPlaceholder("Breaking Bad", false)).toBe("Breaking Bad");
  });

  test("every app-shell timer is classified, and a new decorative timer fails", () => {
    const sources = new Map(
      collectSourceFiles("apps/cli/src/app-shell").map(
        (file) => [file, readRepoFile(file)] as const,
      ),
    );
    expect(auditPlainTimers(sources)).toEqual([]);
    const synthetic = new Map([
      [
        "apps/cli/src/app-shell/synthetic-chime.tsx",
        // sleep-allow: synthetic timer text for the quietness audit, not a wait this test runs
        "export function chime() { setInterval(() => setFrame(1), 80); }",
      ],
    ]);
    expect(auditPlainTimers(synthetic)).toEqual([
      'apps/cli/src/app-shell/synthetic-chime.tsx (timer without plainTimerAllowed("decorative" | "functional") or reducedMotionEnabled)',
    ]);
    expect(
      auditPlainTimers(
        new Map([
          [
            "apps/cli/src/app-shell/synthetic-chime.tsx",
            // sleep-allow: synthetic timer text for the quietness audit, not a wait this test runs
            'export function chime() { if (plainTimerAllowed("decorative")) setInterval(() => setFrame(1), 80); }',
          ],
        ]),
      ),
    ).toEqual([]);
  });

  test("plain mode at 54x25 does not churn while idle or while loading", () => {
    process.env.KUNAI_PLAIN = "1";
    setPlainModePreferenceSource(() => false);
    const now = Date.now;
    let clock = 1_000;
    Date.now = () => clock;
    try {
      const loading = simulateTicks(
        <LoadingShell
          state={{ title: "Quiet", operation: "resolving", stage: "finding-stream" }}
        />,
        {
          rounds: 4,
          columns: 54,
          rows: 25,
          tick: () => {
            clock += 1_000;
          },
        },
      );
      expect(loading.distinctFrames).toBe(1);

      const idle = simulateTicks(
        <BrowseShell
          mode="series"
          provider="smoke"
          placeholder="Breaking Bad"
          commands={fallbackCommandState(["settings"])}
          onSearch={async () => ({ options: [], subtitle: "" })}
          onResolve={() => {}}
          onSubmit={() => {}}
          onCancel={() => {}}
        />,
        {
          rounds: 4,
          columns: 54,
          rows: 25,
          tick: () => {
            clock += 1_000;
          },
        },
      );
      expect(idle.distinctFrames).toBe(1);
    } finally {
      Date.now = now;
    }
  });
});
