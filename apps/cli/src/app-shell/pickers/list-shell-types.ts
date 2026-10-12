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

export type ShellOption<T> = {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
  readonly previewImageUrl?: string;
  /**
   * Unavailable right now. Still selectable -- picking one surfaces the reason
   * in `detail` -- but rendered so availability is legible before the pick
   * rather than only after it.
   */
  readonly disabled?: boolean;
  /** Discards data or resets state; rendered in a warning tone. */
  readonly destructive?: boolean;
};
