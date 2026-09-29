import { describe, expect, test } from "bun:test";

import {
  countAffectedTasks,
  needsFullRun,
  runAffectedOrFull,
} from "../../../../../scripts/ci-affected-run";

describe("needsFullRun", () => {
  // Zero is the only vacuous case: `--affected` that selected nothing exits 0
  // having proven nothing, which is the entire defect.
  test("zero selected tasks is the vacuous case", () => {
    expect(needsFullRun(0)).toBe(true);
  });

  test("one selected task is a real signal, however small", () => {
    // The affected set is a statement about blast radius, not about whether the
    // task ran. Treating "small" as "vacuous" would reintroduce the bug for
    // single-package PRs, which are the common case.
    expect(needsFullRun(1)).toBe(false);
  });

  test("a larger selection is never vacuous", () => {
    expect(needsFullRun(2)).toBe(false);
    expect(needsFullRun(51)).toBe(false);
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

  test("a real selection stays on --affected", () => {
    const calls: { readonly args: readonly string[] }[] = [];

    runAffectedOrFull("test", [], process.env, {
      countTasks: () => 4,
      runTurbo: (_task, args) => {
        calls.push({ args });
        return 0;
      },
      log: () => {},
    });

    expect(calls[0]?.args).toEqual(["--affected"]);
  });

  test("passthrough arguments survive both branches, in order", () => {
    const affected: { readonly args: readonly string[] }[] = [];
    const full: { readonly args: readonly string[] }[] = [];

    runAffectedOrFull("test", ["--summarize"], process.env, {
      countTasks: () => 3,
      runTurbo: (_t, args) => {
        affected.push({ args });
        return 0;
      },
      log: () => {},
    });
    runAffectedOrFull("test", ["--summarize"], process.env, {
      countTasks: () => 0,
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
