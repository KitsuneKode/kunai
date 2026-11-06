import { describe, expect, test } from "bun:test";

import { CLI_SUBCOMMANDS, KNOWN_FLAGS, VALUE_FLAGS } from "@/cli-args";
import {
  COMPLETION_SHELLS,
  isCompletionShell,
  renderCompletionScript,
} from "@/services/completion/completion-script";

describe("isCompletionShell", () => {
  test("accepts every advertised shell and rejects others", () => {
    for (const shell of COMPLETION_SHELLS) expect(isCompletionShell(shell)).toBe(true);
    expect(isCompletionShell("nushell")).toBe(false);
    expect(isCompletionShell("")).toBe(false);
  });
});

describe("renderCompletionScript", () => {
  test("every shell renders a non-empty script", () => {
    for (const shell of COMPLETION_SHELLS) {
      expect(renderCompletionScript(shell).trim().length).toBeGreaterThan(0);
    }
  });

  // The point of generating these from cli-args is that they cannot drift from
  // the parser. A flag added there and not offered here is the bug this catches.
  test("bash and zsh offer every flag the parser knows", () => {
    for (const shell of ["bash", "zsh"] as const) {
      const script = renderCompletionScript(shell);
      for (const flag of KNOWN_FLAGS) expect(script).toContain(flag);
    }
  });

  test("every shell offers every maintenance subcommand", () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = renderCompletionScript(shell);
      for (const sub of CLI_SUBCOMMANDS) expect(script).toContain(sub);
    }
  });

  test("fish declares a completion line per flag", () => {
    const script = renderCompletionScript("fish");
    for (const flag of KNOWN_FLAGS) {
      const spec = flag.startsWith("--") ? `-l ${flag.slice(2)}` : `-s ${flag.slice(1)}`;
      expect(script).toContain(spec);
    }
  });

  test("long value-taking flags expect a value in fish", () => {
    const script = renderCompletionScript("fish");
    for (const flag of VALUE_FLAGS) {
      if (!flag.startsWith("--")) continue;
      const line = script
        .split("\n")
        .find((l) => l.includes(`-l ${flag.slice(2)}`) && !l.includes("__fish_seen"));
      expect(line).toBeDefined();
      expect(line).toMatch(/ -x| -r/);
    }
  });

  test("bash case arms are unique (no dead duplicate patterns)", () => {
    const arms = renderCompletionScript("bash")
      .split("\n")
      .filter((line) => /^\s{4}[-a-z|]+\)$/.test(line))
      .map((line) => line.trim());
    expect(new Set(arms).size).toBe(arms.length);
  });

  test("each script targets the kunai binary", () => {
    expect(renderCompletionScript("bash")).toContain("complete -F _kunai_complete kunai");
    expect(renderCompletionScript("zsh")).toContain("compdef _kunai kunai");
    expect(renderCompletionScript("fish")).toContain("complete -c kunai");
    expect(renderCompletionScript("powershell")).toContain("-CommandName kunai");
  });

  test("zsh does not offer flags while completing a value-taking flag argument", () => {
    const script = renderCompletionScript("zsh");
    expect(script).toContain('if (( i < CURRENT - 1 )) && [[ "${words[CURRENT]}" != -* ]]; then');
    expect(script).toContain("return");
    expect(script).toContain("--hwdec) _describe 'hwdec' hwdecs");
    expect(script).toContain("default");
    expect(script).toContain("auto-safe");
    expect(script).toContain("no");
  });

  test("powershell suppresses flag completion when the previous token consumed a value", () => {
    const script = renderCompletionScript("powershell");
    expect(script).toContain("$valueFlags = @(");
    expect(script).toContain(
      "if ($valueFlags -contains $prevPrev -and $prev -notlike '-*' -and -not $wordToComplete.StartsWith('-'))",
    );
    expect(script).toContain("return");
    expect(script).toContain("'--hwdec' { $hwdecs }");
    expect(script).toContain("Get-ChildItem -Path ($wordToComplete + '*') -Directory");
    expect(script).toContain("Get-ChildItem -Path ($wordToComplete + '*') -File");
  });
});
