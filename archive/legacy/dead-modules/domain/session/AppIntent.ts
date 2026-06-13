import type { AppCommandId } from "./command-registry";

export type AppIntent =
  | {
      readonly type: "command";
      readonly command: AppCommandId;
      readonly source: "command-palette" | "footer" | "hotkey" | "mpv";
    }
  | {
      readonly type: "picker-selection";
      readonly pickerId: string;
      readonly value: string;
    }
  | {
      readonly type: "picker-cancel";
      readonly pickerId: string;
    };
