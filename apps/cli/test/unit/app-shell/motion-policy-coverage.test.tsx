import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ExitShell } from "@/app-shell/exit-shell";
import { LoadingShell } from "@/app-shell/loading-shell";
import { getLoadingShellTimerPolicy } from "@/app-shell/loading-shell-runtime";
import { setPlainModePreferenceSource } from "@/app-shell/plain-mode";
import { LoadingState } from "@/app-shell/primitives/LoadingState";
import { SakuraPetal } from "@/app-shell/primitives/SakuraPetal";
import { GlimmerLabel, SakuraBloom, SakuraLoader } from "@/app-shell/SakuraLoader";
import { DependencyScreen } from "@/app-shell/setup/SetupScreens";

import { simulateTicks } from "../../harness/render-capture";
import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

/**
 * Every file under `apps/cli/src/app-shell/` that drives frame-by-frame motion
 * (either directly via `setInterval` / staggered `setTimeout` animations or by
 * invoking `useFrameTick` / `useSakuraFrame` / frame arrays).
 *
 * Adding a new animated component to `app-shell/` without gating it on
 * `reducedMotionEnabled` (directly or via `useFrameTick` / `useSakuraFrame`)
 * and recording it here fails this test.
 */
const AUDITED_ANIMATED_FILES: ReadonlyMap<
  string,
  { readonly gate: "reducedMotionEnabled" | "useFrameTick" | "useSakuraFrame" }
> = new Map([
  ["apps/cli/src/app-shell/primitives/SakuraPetal.tsx", { gate: "reducedMotionEnabled" }],
  ["apps/cli/src/app-shell/primitives/LoadingState.tsx", { gate: "reducedMotionEnabled" }],
  ["apps/cli/src/app-shell/SakuraLoader.tsx", { gate: "reducedMotionEnabled" }],
  ["apps/cli/src/app-shell/setup-shell.tsx", { gate: "useFrameTick" }],
  ["apps/cli/src/app-shell/setup/SetupScreens.tsx", { gate: "reducedMotionEnabled" }],
  ["apps/cli/src/app-shell/exit-shell.tsx", { gate: "reducedMotionEnabled" }],
  ["apps/cli/src/app-shell/loading-shell-runtime.ts", { gate: "reducedMotionEnabled" }],
]);

/**
 * Non-animation intervals in `app-shell/` that poll live state or wall clocks
 * rather than animating glyphs. Each must stay honest: if one starts driving
 * frame animations, move it to `AUDITED_ANIMATED_FILES` and gate it.
 */
const NON_ANIMATION_INTERVAL_FILES: ReadonlyMap<string, string> = new Map([
  ["apps/cli/src/app-shell/hooks/use-calendar-now.ts", "wall-clock minute refresh for air times"],
  ["apps/cli/src/app-shell/playback-mount-shell.tsx", "mpv playback position/status poll"],
  [
    "apps/cli/src/app-shell/ink-shell.tsx",
    "notification, presence, and toast timers — not a glyph frame loop",
  ],
  ["apps/cli/src/app-shell/download-status-monitor.ts", "active download queue progress poll"],
  [
    "apps/cli/src/app-shell/loading-shell.tsx",
    "elapsed seconds counter, memory panel auto-hide, and runtime health poll (animations delegated to SakuraBloom/GlimmerLabel)",
  ],
  [
    "apps/cli/src/app-shell/use-poster-preview.ts",
    "poster fetch debounce and delayed spinner arm, not a glyph frame loop",
  ],
  [
    "apps/cli/src/app-shell/checklist-shell.tsx",
    "confirm delay before submit, not a frame animation",
  ],
  ["apps/cli/src/app-shell/browse-shell.tsx", "action-feedback and search debounce timers"],
  [
    "apps/cli/src/app-shell/mouse/mouse-stdin.ts",
    "coalesce a partial mouse report, not a frame animation",
  ],
  ["apps/cli/src/app-shell/workflows/shell-workflows.ts", "clear a transient download-queued note"],
  [
    "apps/cli/src/app-shell/use-viewport-policy.ts",
    "debounce terminal resize before recomputing layout",
  ],
  ["apps/cli/src/app-shell/hooks/use-dwell-prefetch.ts", "dwell delay before prefetch"],
  [
    "apps/cli/src/app-shell/hooks/use-search-suggestions.ts",
    "debounce before requesting suggestions",
  ],
  ["apps/cli/src/app-shell/hooks/use-settled-value.ts", "settle a rapidly changing value"],
  [
    "apps/cli/src/app-shell/dismiss-timer-registry.ts",
    "shared dismiss timer, not a frame animation",
  ],
  ["apps/cli/src/app-shell/sixel-overlay.ts", "flush a queued sixel paint after Ink's frame"],
  ["apps/cli/src/app-shell/settings/SettingsShell.tsx", "debounce settings draft persistence"],
  ["apps/cli/src/app-shell/root-overlay-shell.tsx", "clear a transient overlay status line"],
]);

const ANIMATION_SIGNAL_REGEX =
  /\b(?:setTimeout|setInterval)\s*\(|\b(?:useFrameTick|useSakuraFrame|BLOOM_FRAMES|BUSY_FRAMES|GRAPHICS_TIMINGS)\b/;

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/** A mention of the gate name is not proof. The file has to call it. */
function gateIsInvoked(source: string, gate: string): boolean {
  return new RegExp(`\\b${gate}\\s*\\(`).test(codeWithoutComments(source));
}

/**
 * Files with a timer or frame animation must either call their declared motion
 * gate or sit on the allowlist with a stated reason. `sources` is injectable
 * so a synthetic file can fail this without landing in app-shell.
 */
function auditMotionSources(
  sources: ReadonlyMap<string, string>,
  audited: ReadonlyMap<string, { readonly gate: string }> = AUDITED_ANIMATED_FILES,
  allowlist: ReadonlyMap<string, string> = NON_ANIMATION_INTERVAL_FILES,
): string[] {
  const violations: string[] = [];
  for (const [file, source] of sources) {
    if (!ANIMATION_SIGNAL_REGEX.test(source)) continue;
    const reason = allowlist.get(file);
    if (reason !== undefined) {
      if (reason.trim().length === 0) {
        violations.push(`${file} (allowlisted without a stated reason)`);
      }
      continue;
    }
    const entry = audited.get(file);
    if (!entry) {
      violations.push(
        `${file} (setTimeout/setInterval or animation signal is not allowlisted with a reason and is not a gated animation)`,
      );
      continue;
    }
    if (!gateIsInvoked(source, entry.gate)) {
      violations.push(`${file} (names ${entry.gate} without calling it)`);
    }
  }
  return violations;
}

type SavedMotionEnv = {
  reduced: string | undefined;
  noMotion: string | undefined;
  plain: string | undefined;
  pet: string | undefined;
};

let savedEnv: SavedMotionEnv = {
  reduced: undefined,
  noMotion: undefined,
  plain: undefined,
  pet: undefined,
};

beforeEach(() => {
  savedEnv = {
    reduced: process.env.KUNAI_REDUCED_MOTION,
    noMotion: process.env.NO_MOTION,
    plain: process.env.KUNAI_PLAIN,
    pet: process.env.KUNAI_PET,
  };
});

function restoreEnv(): void {
  setPlainModePreferenceSource(() => false);
  for (const [key, value] of [
    ["KUNAI_REDUCED_MOTION", savedEnv.reduced],
    ["NO_MOTION", savedEnv.noMotion],
    ["KUNAI_PLAIN", savedEnv.plain],
    ["KUNAI_PET", savedEnv.pet],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv();
});

describe("motion policy coverage inventory", () => {
  test("every animated component in app-shell is audited and gated on reducedMotionEnabled", () => {
    const sources = new Map(
      collectSourceFiles("apps/cli/src/app-shell").map(
        (file) => [file, readRepoFile(file)] as const,
      ),
    );
    expect(
      auditMotionSources(sources),
      "new setTimeout/setInterval or animation in app-shell — gate it by calling reducedMotionEnabled/useFrameTick/useSakuraFrame, or allowlist it with a stated reason",
    ).toEqual([]);
  });

  test("a synthetic setTimeout animation fails unless it calls its gate or is allowlisted with a reason", () => {
    const file = "apps/cli/src/app-shell/synthetic-spinner.tsx";
    const commentOnly = `
      // reducedMotionEnabled is mentioned here and must not count as a gate
      export function spin() {
        // sleep-allow: synthetic source fixture for the motion audit, not a wait this test runs
        setTimeout(() => setFrame(1), 80);
      }
    `;
    const called = `
      import { reducedMotionEnabled } from "./motion-policy";
      export function spin() {
        if (reducedMotionEnabled()) return;
        // sleep-allow: synthetic source fixture for the motion audit, not a wait this test runs
        setInterval(() => setFrame(1), 80);
      }
    `;
    const audited = new Map([[file, { gate: "reducedMotionEnabled" }]]);
    expect(auditMotionSources(new Map([[file, commentOnly]]))).not.toEqual([]);
    expect(auditMotionSources(new Map([[file, commentOnly]]), audited)).not.toEqual([]);
    expect(auditMotionSources(new Map([[file, called]]), audited)).toEqual([]);
    expect(
      auditMotionSources(
        new Map([[file, commentOnly]]),
        new Map(),
        new Map([[file, "status poll, not a glyph animation"]]),
      ),
    ).toEqual([]);
    expect(
      auditMotionSources(new Map([[file, commentOnly]]), new Map(), new Map([[file, "   "]])),
    ).not.toEqual([]);
  });

  test("audited motion inventory has no stale paths", () => {
    const existing = new Set(collectSourceFiles("apps/cli/src/app-shell"));
    for (const file of [...AUDITED_ANIMATED_FILES.keys(), ...NON_ANIMATION_INTERVAL_FILES.keys()]) {
      expect(existing.has(file), `stale inventory entry: ${file}`).toBe(true);
    }
  });
});

describe("every animated surface stays still under reduced motion and plain mode", () => {
  const MOTION_OFF_ENVS = [
    ["KUNAI_REDUCED_MOTION=1", { KUNAI_REDUCED_MOTION: "1" }],
    ["NO_MOTION=1", { NO_MOTION: "1" }],
    ["KUNAI_PLAIN=1", { KUNAI_PLAIN: "1" }],
  ] as const;

  for (const [label, envPatch] of MOTION_OFF_ENVS) {
    test(`${label} freezes every animated primitive and shell`, () => {
      delete process.env.KUNAI_REDUCED_MOTION;
      delete process.env.NO_MOTION;
      delete process.env.KUNAI_PLAIN;
      process.env.KUNAI_PET = "off";
      Object.assign(process.env, envPatch);

      expect(getLoadingShellTimerPolicy({ operation: "resolving" }).animate).toBe(false);

      const cases = [
        ["SakuraPetal", <SakuraPetal key="petal" mode="loading" active />],
        ["SakuraBloom", <SakuraBloom key="bloom" active stalled={false} />],
        [
          "GlimmerLabel",
          <GlimmerLabel key="glimmer" label="Resolving stream…" active stalled={false} />,
        ],
        ["SakuraLoader", <SakuraLoader key="loader" label="Searching…" active />],
        ["LoadingState", <LoadingState key="loading" message="Loading panel…" active />],
        [
          "LoadingShell",
          <LoadingShell
            key="shell"
            state={{ title: "Motion audit", operation: "resolving", stage: "finding-stream" }}
          />,
        ],
        [
          "DependencyScreen",
          <DependencyScreen
            key="deps"
            rows={[
              {
                id: "mpv",
                name: "mpv",
                state: "ok",
                detail: "found",
                role: "player",
                fix: null,
                scope: "always",
              },
            ]}
            selected={0}
            rechecking
            tick={0}
            showFix={false}
          />,
        ],
      ] as const;

      for (const [name, element] of cases) {
        const report = simulateTicks(element, { rounds: 6, columns: 100, rows: 30 });
        expect(report.distinctFrames, `${name} under ${label}`).toBe(1);
      }
    });

    test(`${label} completes ExitShell without staggered fade animation`, () => {
      delete process.env.KUNAI_REDUCED_MOTION;
      delete process.env.NO_MOTION;
      delete process.env.KUNAI_PLAIN;
      process.env.KUNAI_PET = "off";
      Object.assign(process.env, envPatch);

      let doneCalls = 0;
      const report = simulateTicks(
        <ExitShell
          onDone={() => {
            doneCalls += 1;
          }}
        />,
        { rounds: 4, columns: 80, rows: 20 },
      );
      expect(report.distinctFrames).toBe(1);
      expect(doneCalls).toBe(1);
    });
  }
});
