import type { MobileTerminalPort } from "../../application/contracts";
import {
  formatMobileChoiceOptions,
  interpretMobileChoiceAnswer,
  MOBILE_INVALID_SELECTION,
} from "../../application/mobile-choice";
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
      write(formatMobileChoiceOptions(selection));
      while (true) {
        write(`${selection.prompt} `);
        if (!removeAnswer()) return { kind: "cancelled" };
        if (input.bridge.runFixedHelper("read-line") !== 0) {
          removeAnswer();
          return { kind: "cancelled" };
        }
        const answer = readAnswer();
        const decision = interpretMobileChoiceAnswer(selection, answer);
        if (decision.kind !== "invalid") return decision;
        write(MOBILE_INVALID_SELECTION);
      }
    },
  };
}
