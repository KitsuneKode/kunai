import type { ResolvedAppCommand } from "@/app-shell/commands";
import type { ShellAction } from "@/app-shell/types";
import type { LocalTitleEntry } from "@/domain/palette/local-title-index";

/** Context passed into `openListShell` / `chooseFromListShell` for command-palette integration in pickers. */
export type ListShellActionContext = {
  readonly commands: readonly ResolvedAppCommand[];
  readonly onAction: (
    action: ShellAction,
  ) => Promise<"handled" | "quit" | "unhandled"> | "handled" | "quit" | "unhandled";
  /**
   * Local title source consulted ONCE when the palette opens — a cheap
   * synchronous read over an already-built index, never a query per keystroke.
   * Omit to keep the palette command-only on this surface.
   */
  readonly localTitles?: () => readonly LocalTitleEntry[];
  /** Enter landed on a JUMP TO title row. */
  readonly onTitlePick?: (entry: LocalTitleEntry) => void;
  readonly taskLabel?: string;
  readonly footerMode?: "detailed" | "minimal";
};

export type ListShellFilterPreference = "auto" | "always" | "never";

export type ShellOption<T> = {
  readonly value: T;
  /**
   * Stable row identity. Required, nonblank, and unique when `destructive` is
   * set. A blank id is not a key. Labels are the fallback only for ordinary rows.
   */
  readonly id?: string;
  readonly label: string;
  /** Compact-mode accelerator. Digits 1-9 also select rows positionally. */
  readonly shortcut?: string;
  readonly detail?: string;
  readonly previewImageUrl?: string;
  /**
   * Unavailable right now. Still selectable -- picking one surfaces the reason
   * in `detail` -- but rendered so availability is legible before the pick
   * rather than only after it.
   */
  readonly disabled?: boolean;
  /** Discards data or resets state. Needs a unique `id`, then confirmation. */
  readonly destructive?: boolean;
  /** Imperative footer verb while armed (for example "remove" or "delete"). */
  readonly confirmVerb?: string;
};
