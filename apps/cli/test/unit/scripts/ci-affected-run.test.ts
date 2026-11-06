import { describe, expect, test } from "bun:test";

import {
  countAffectedTasks,
  hasGlobalBlastFiles,
  needsFullRun,
  runAffectedOrFull,
} from "../../../../../scripts/ci-affected-run";

describe("hasGlobalBlastFiles", () => {
  test("identifies root config files as global blast", () => {
    expect(hasGlobalBlastFiles(["bunfig.toml"])).toBe(true);
    expect(hasGlobalBlastFiles(["turbo.json"])).toBe(true);
    expect(hasGlobalBlastFiles(["package.json"])).toBe(true);
    expect(hasGlobalBlastFiles(["bun.lock"])).toBe(true);
    expect(hasGlobalBlastFiles(["tsconfig.base.json"])).toBe(true);
    expect(hasGlobalBlastFiles(["LICENSE"])).toBe(true);
    expect(hasGlobalBlastFiles([".oxlintrc.json"])).toBe(true);
    expect(hasGlobalBlastFiles([".oxfmtrc.json"])).toBe(true);
  });

  test("identifies root tooling and workflow directories as global blast", () => {
    expect(hasGlobalBlastFiles(["scripts/ci-affected-run.ts"])).toBe(true);
    expect(hasGlobalBlastFiles(["tools/oxlint/rule.js"])).toBe(true);
    expect(hasGlobalBlastFiles([".github/workflows/ci.yml"])).toBe(true);
    expect(hasGlobalBlastFiles(["patches/some.patch"])).toBe(true);
  });

  test("does not flag ordinary workspace files or doc files as global blast", () => {
    expect(hasGlobalBlastFiles(["apps/cli/src/main.ts"])).toBe(false);
    expect(hasGlobalBlastFiles(["apps/mobile/src/entry.ts"])).toBe(false);
    expect(hasGlobalBlastFiles(["packages/storage/src/index.ts"])).toBe(false);
    expect(hasGlobalBlastFiles(["README.md"])).toBe(false);
  });
});

describe("needsFullRun", () => {
  // Zero is the only vacuous case: `--affected` that selected nothing exits 0
  // having proven nothing, which is the entire defect.
  test("zero selected tasks is the vacuous case", () => {
    expect(needsFullRun(0)).toBe(true);
  });

  test("one selected task is a real signal when no global blast files changed", () => {
    // The affected set is a statement about blast radius, not about whether the
    // task ran. Treating "small" as "vacuous" would reintroduce the bug for
    // single-package PRs, which are the common case.
    expect(needsFullRun(1, false)).toBe(false);
  });

  test("a larger selection is never vacuous when no global blast files changed", () => {
    expect(needsFullRun(2, false)).toBe(false);
    expect(needsFullRun(51, false)).toBe(false);
  });

  test("forces full run if any global blast file changed, even with selected tasks", () => {
    expect(needsFullRun(1, true)).toBe(true);
    expect(needsFullRun(5, true)).toBe(true);
  });
});

describe("runAffectedOrFull", () => {
  /**
   * Turbo's own `--affected` selection depends on git state, so these assert
   * the decision and the command that follows it against a supplied count.
   * The behaviour being guarded is reproduced for real in the PR description:
   * a branch whose only commit touches `README.md` makes turbo print
   * "No tasks were executed as part of this run" and exit 0.
   */
  test("a vacuous selection runs the full graph instead of reporting success", () => {
    const calls: { readonly args: readonly string[] }[] = [];
    const messages: string[] = [];

    const code = runAffectedOrFull("typecheck", ["--summarize"], process.env, {
      countTasks: () => 0,
      runTurbo: (_task, args) => {
        calls.push({ args });
        return 0;
      },
      log: (message) => messages.push(message),
    });

    expect(code).toBe(0);
    // The whole point: `--affected` must NOT be in the argument list, or turbo
    // would select nothing and exit 0 having run nothing.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["--summarize"]);
    expect(calls[0]?.args).not.toContain("--affected");
    expect(messages.join("")).toContain("Running the full graph");
  });

  test("a real selection stays on --affected when no global blast files changed", () => {
    const calls: { readonly args: readonly string[] }[] = [];

    runAffectedOrFull("test", [], process.env, {
      countTasks: () => 4,
      getChangedFiles: () => ["apps/mobile/src/entry.ts"],
      runTurbo: (_task, args) => {
        calls.push({ args });
        return 0;
      },
      log: () => {},
    });

    expect(calls[0]?.args).toEqual(["--affected"]);
  });

  test("forces full run if a global blast file changed alongside package tasks", () => {
    const calls: { readonly args: readonly string[] }[] = [];
    const messages: string[] = [];

    runAffectedOrFull("test", ["--summarize"], process.env, {
      countTasks: () => 2,
      getChangedFiles: () => ["apps/mobile/src/entry.ts", "bunfig.toml"],
      runTurbo: (_task, args) => {
        calls.push({ args });
        return 0;
      },
      log: (message) => messages.push(message),
    });

    expect(calls[0]?.args).toEqual(["--summarize"]);
    expect(calls[0]?.args).not.toContain("--affected");
    expect(messages.join("")).toContain(
      "root configuration or global tooling changed (bunfig.toml)",
    );
  });

  test("passthrough arguments survive both branches, in order", () => {
    const affected: { readonly args: readonly string[] }[] = [];
    const full: { readonly args: readonly string[] }[] = [];

    runAffectedOrFull("test", ["--summarize"], process.env, {
      countTasks: () => 3,
      getChangedFiles: () => [],
      runTurbo: (_t, args) => {
        affected.push({ args });
        return 0;
      },
      log: () => {},
    });
    runAffectedOrFull("test", ["--summarize"], process.env, {
      countTasks: () => 0,
      getChangedFiles: () => [],
      runTurbo: (_t, args) => {
        full.push({ args });
        return 0;
      },
      log: () => {},
    });

    expect(affected[0]?.args).toEqual(["--affected", "--summarize"]);
    expect(full[0]?.args).toEqual(["--summarize"]);
  });

  test("a failing full run still fails the job", () => {
    // The fallback must not swallow a real failure: CI's blocking signal has to
    // survive the safety net.
    const code = runAffectedOrFull("typecheck", [], process.env, {
      countTasks: () => 0,
      runTurbo: () => 1,
      log: () => {},
    });
    expect(code).toBe(1);
  });
});

describe("countAffectedTasks", () => {
  test("reports zero rather than throwing when turbo cannot be run", () => {
    // An unrunnable or unparseable dry run must not skip the task; it has to
    // fall through to the full graph.
    expect(countAffectedTasks("typecheck", [], { ...process.env, PATH: "/nonexistent" })).toBe(0);
  }, 60_000);
});
