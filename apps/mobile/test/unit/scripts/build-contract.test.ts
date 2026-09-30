import { describe, expect, test } from "bun:test";

import {
  findForbiddenAndroidInputs,
  findForbiddenAndroidOutputTokens,
  findForbiddenIosInputs,
  findForbiddenIosOutputTokens,
  findForbiddenIosProcessUses,
  MOBILE_TARGETS,
  resolveRuntimeModule,
} from "../../../scripts/build-contract";

function metafile(inputs: readonly string[]) {
  return {
    inputs: Object.fromEntries(inputs.map((path) => [path, { bytes: 1, imports: [] }])),
    outputs: {},
  };
}

describe("mobile artifact build contract", () => {
  test("declares one architecture-neutral Termux bundle and the a-Shell bundle", () => {
    expect(MOBILE_TARGETS.map((target) => target.id)).toEqual([
      "android-termux-node",
      "ios-ashell",
    ]);
    expect(MOBILE_TARGETS[0]).toMatchObject({
      output: "android/kunai-mobile-android.mjs",
      runtime: "android",
    });
    expect(MOBILE_TARGETS[0]).not.toHaveProperty("compileTarget");
    expect(resolveRuntimeModule("android-termux-node")).toEndWith(
      "src/runtime/android/composition.ts",
    );
    expect(resolveRuntimeModule("ios-ashell")).toEndWith("src/runtime/ashell/composition.ts");
  });

  test("rejects native, desktop, test, and planning files from the iOS graph", () => {
    expect(
      findForbiddenIosInputs(
        metafile([
          "src/entry.ts",
          "src/application/run-mobile-application.ts",
          "src/runtime/ashell/composition.ts",
        ]),
      ),
    ).toEqual([]);
    expect(
      findForbiddenIosInputs(
        metafile([
          "node:fs",
          "src/runtime/android/composition.ts",
          "node_modules/react/index.js",
          "test/unit/fake.ts",
          ".plans/mobile.md",
        ]),
      ),
    ).toEqual([
      ".plans/mobile.md",
      "node:fs",
      "node_modules/react/index.js",
      "src/runtime/android/composition.ts",
      "test/unit/fake.ts",
    ]);
  });

  test("rejects Bun, a-Shell, desktop, test, and planning files from the Android graph", () => {
    expect(
      findForbiddenAndroidInputs(
        metafile([
          "src/entry.ts",
          "src/application/run-mobile-application.ts",
          "src/runtime/android/composition.ts",
        ]),
      ),
    ).toEqual([]);
    expect(
      findForbiddenAndroidInputs(
        metafile([
          "bun:sqlite",
          "src/runtime/ashell/composition.ts",
          "apps/cli/src/main.ts",
          "test/unit/fake.ts",
          ".plans/mobile.md",
        ]),
      ),
    ).toEqual([
      ".plans/mobile.md",
      "apps/cli/src/main.ts",
      "bun:sqlite",
      "src/runtime/ashell/composition.ts",
      "test/unit/fake.ts",
    ]);
  });

  test("finds Bun runtime tokens in emitted Android JavaScript", () => {
    expect(findForbiddenAndroidOutputTokens("process.stdout.write('ok')")).toEqual([]);
    expect(findForbiddenAndroidOutputTokens("Bun.file('x'); import 'bun:sqlite';")).toEqual([
      "Bun",
      "bun:",
    ]);
    expect(findForbiddenAndroidOutputTokens("globalThis.Bun?.file('x')")).toEqual(["Bun"]);
  });

  test("rejects every process API from the iOS graph", () => {
    expect(
      findForbiddenIosProcessUses({
        "src/entry.ts": "const value = 1;",
      }),
    ).toEqual([]);
    expect(
      findForbiddenIosProcessUses({
        "src/runtime/ashell/composition.ts":
          "const host = (globalThis as { process?: unknown }).process;",
        "src/runtime/ashell/bad.ts": "const value = process.argv;",
        "src/application/bad.ts": "process.exit(1);",
      }),
    ).toEqual([
      "src/application/bad.ts",
      "src/runtime/ashell/bad.ts",
      "src/runtime/ashell/composition.ts",
    ]);
  });

  test("finds runtime-only tokens in emitted iOS JavaScript", () => {
    expect(findForbiddenIosOutputTokens("(()=>{console.log('ok')})()")).toEqual([]);
    expect(
      findForbiddenIosOutputTokens(
        "require('x'); process.env.X; process['argv']; Buffer.from('x'); Bun.file('x'); node:fs",
      ),
    ).toEqual(["Buffer", "Bun.", "node:", "process", "require("]);
    for (const source of ["process?.env", "const {env}=process", 'globalThis["process"].env']) {
      expect(findForbiddenIosOutputTokens(source)).toContain("process");
    }
  });
});
