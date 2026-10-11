import { describe, expect, test } from "bun:test";

import type { AShellCommandBridge } from "../../../../src/runtime/ashell/ashell-command-bridge";
import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { createAShellTerminalPort } from "../../../../src/runtime/ashell/ashell-terminal-port";

const ANSWER_PATH = ".runtime/terminal-answer";
const CHOICES = [
  { value: "continue", label: "Run proof" },
  { value: "cancel", label: "Cancel" },
] as const;

function terminalFixture(input: {
  readonly answers?: readonly (string | undefined)[];
  readonly helperStatus?: number;
  readonly retainDeletedFiles?: boolean;
}) {
  const files = new Map<string, string>();
  const answers = [...(input.answers ?? [])];
  const output: string[] = [];
  const jsc: AShellJsc = {
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing file");
      return value;
    },
    writeFile: (path, value) => {
      files.set(path, value);
      return 0;
    },
    isFile: (path) => files.has(path),
    makeFolder: () => 0,
    delete: (path) => {
      if (!input.retainDeletedFiles) files.delete(path);
      return 0;
    },
    move: () => 0,
    system: () => 0,
  };
  const bridge: AShellCommandBridge = {
    runFixedHelper(name) {
      expect(name).toBe("read-line");
      const answer = answers.shift();
      if (answer !== undefined) files.set(ANSWER_PATH, `${answer}\n`);
      return input.helperStatus ?? 0;
    },
  };
  return {
    files,
    output,
    port: createAShellTerminalPort({
      jsc,
      bridge,
      write: (value) => output.push(value),
    }),
  };
}

describe("a-Shell terminal port", () => {
  test("accepts a number or exact value and removes the answer file", async () => {
    for (const answer of ["1", "continue"]) {
      const fixture = terminalFixture({ answers: [answer] });
      await expect(fixture.port.choose({ prompt: "Continue?", choices: CHOICES })).resolves.toEqual(
        { kind: "selected", value: "continue" },
      );
      expect(fixture.files.has(ANSWER_PATH)).toBe(false);
      expect(fixture.output.join("")).toContain("1. Run proof");
    }
  });

  test("retries invalid input before accepting a valid choice", async () => {
    const fixture = terminalFixture({ answers: ["not-a-choice", "2"] });
    await expect(fixture.port.choose({ prompt: "Continue?", choices: CHOICES })).resolves.toEqual({
      kind: "selected",
      value: "cancel",
    });
    expect(fixture.output.join("")).toContain("Invalid selection");
  });

  test("treats zero, empty input, helper failure, and missing output as cancellation", async () => {
    for (const fixture of [
      terminalFixture({ answers: ["0"] }),
      terminalFixture({ answers: [""] }),
      terminalFixture({ answers: ["1"], helperStatus: 130 }),
      terminalFixture({ answers: [undefined] }),
    ]) {
      await expect(fixture.port.choose({ prompt: "Continue?", choices: CHOICES })).resolves.toEqual(
        { kind: "cancelled" },
      );
      expect(fixture.files.has(ANSWER_PATH)).toBe(false);
    }
  });

  test("cancels when answer-file deletion is not observable", async () => {
    const fixture = terminalFixture({ answers: ["1"], retainDeletedFiles: true });

    await expect(fixture.port.choose({ prompt: "Continue?", choices: CHOICES })).resolves.toEqual({
      kind: "cancelled",
    });
    expect(fixture.files.has(ANSWER_PATH)).toBe(true);
  });

  test("clears a staged answer when the host closes", async () => {
    const fixture = terminalFixture({});
    fixture.files.set(ANSWER_PATH, "stale\n");

    await fixture.port.close();

    expect(fixture.files.has(ANSWER_PATH)).toBe(false);
  });

  test("writes no doubled newline or blank-padded prompt", async () => {
    const fixture = terminalFixture({ answers: ["1"] });

    await fixture.port.render([
      "Kunai mobile host proof",
      "No playback progress will be recorded.",
    ]);
    await fixture.port.choose({
      prompt: "Continue?",
      choices: [{ value: "continue", label: "Run proof" }],
    });

    expect(fixture.output).toEqual([
      "Kunai mobile host proof\nNo playback progress will be recorded.\n",
      "1. Run proof\n0. Cancel\n",
      "Continue?",
    ]);
    expect(fixture.output.join("")).not.toContain("\n\n");
    expect(fixture.output.at(-1)).not.toContain("? ");
  });
});
