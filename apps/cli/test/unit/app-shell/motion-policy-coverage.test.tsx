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
  ["apps/cli/src/app-shell/ink-shell.tsx", "notification & presence background poll"],
  ["apps/cli/src/app-shell/download-status-monitor.ts", "active download queue progress poll"],
  [
    "apps/cli/src/app-shell/loading-shell.tsx",
    "elapsed seconds counter, memory & runtime health poll (animations delegated to SakuraBloom/GlimmerLabel)",
  ],
]);

const ANIMATION_SIGNAL_REGEX =
  /\b(?:setInterval|useFrameTick|useSakuraFrame|BLOOM_FRAMES|BUSY_FRAMES|GRAPHICS_TIMINGS)\b/;

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
    const files = collectSourceFiles("apps/cli/src/app-shell");
    const unaudited: string[] = [];
    const missingGate: string[] = [];

    for (const file of files) {
      const source = readRepoFile(file);
      if (!ANIMATION_SIGNAL_REGEX.test(source)) continue;

      if (NON_ANIMATION_INTERVAL_FILES.has(file)) continue;

      const entry = AUDITED_ANIMATED_FILES.get(file);
      if (!entry) {
        unaudited.push(file);
        continue;
      }
      if (!source.includes(entry.gate)) {
        missingGate.push(`${file} (expected ${entry.gate})`);
      }
    }

    expect(
      unaudited,
      "new animated component or interval found in app-shell — gate it on reducedMotionEnabled and add it to AUDITED_ANIMATED_FILES",
    ).toEqual([]);
    expect(missingGate, "audited animated file no longer references its motion gate").toEqual([]);
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
