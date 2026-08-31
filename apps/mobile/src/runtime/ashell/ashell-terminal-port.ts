import type { MobileTerminalPort } from "../../application/contracts";
import type { AShellCommandBridge } from "./ashell-command-bridge";
import type { AShellJsc } from "./ashell-globals";

const ANSWER_PATH = ".runtime/terminal-answer";

export function createAShellTerminalPort(input: {
  readonly jsc: AShellJsc;
  readonly bridge: AShellCommandBridge;
  readonly write?: (value: string) => void;
}): MobileTerminalPort {
  const write = input.write ?? ((value: string) => console.log(value));

  function removeAnswer(): boolean {
    if (!input.jsc.isFile(ANSWER_PATH)) return true;
    return input.jsc.deleteFile(ANSWER_PATH) === 0 && !input.jsc.isFile(ANSWER_PATH);
  }

  function readAnswer(): string | undefined {
    if (!input.jsc.isFile(ANSWER_PATH)) return undefined;
    try {
      return input.jsc.readFile(ANSWER_PATH).replace(/\r?\n$/u, "");
    } finally {
      removeAnswer();
    }
  }

  return {
    async render(lines) {
      write(`${lines.join("\n")}\n`);
    },
    async choose(selection) {
      write(
        `${selection.choices
          .map((choice, index) => `${index + 1}. ${choice.label}`)
          .join("\n")}\n0. Cancel\n`,
      );
      while (true) {
        write(`${selection.prompt} `);
        if (!removeAnswer()) return { kind: "cancelled" };
        if (input.bridge.runFixedHelper("read-line") !== 0) {
          removeAnswer();
          return { kind: "cancelled" };
        }
        const answer = readAnswer();
        if (answer === undefined || answer === "" || answer === "0") {
          return { kind: "cancelled" };
        }
        const numeric = /^[1-9]\d*$/u.test(answer) ? Number(answer) : Number.NaN;
        const numericChoice = Number.isSafeInteger(numeric)
          ? selection.choices[numeric - 1]
          : undefined;
        const choice =
          numericChoice ?? selection.choices.find((candidate) => candidate.value === answer);
        if (choice) return { kind: "selected", value: choice.value };
        write("Invalid selection. Try again.\n");
      }
    },
  };
}
