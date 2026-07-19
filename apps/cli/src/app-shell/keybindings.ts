import type { LineEditorKey } from "@/app-shell/line-editor";
import type { AppCommandId } from "@/domain/session/command-registry";

import type { FooterAction, ShellAction } from "./types";

/**
 * Single source of truth for raw key chords (Esc / arrows / Enter / `/` / `?`, the
 * mpv-window playback keys, and the post-play footer keys), distinct from the
 * slash-command registry in `domain/session/command-registry` (which owns `/command`
 * palette entries). The `?` help overlay reads {@link helpSections} and the footer
 * hint row reads {@link footerHints}, so what is documented can never drift from the
 * keys that are actually bound.
 *
 * Accuracy note: the in-player ("player" scope) chords mirror the mpv Lua bridge
 * (`apps/cli/assets/mpv/kunai-bridge.lua`) exactly — `n`/`p` navigate, `b` skips,
 * `k` opens the quality picker in the terminal, Ctrl+R refreshes the stream, Alt+R
 * resumes to the saved position. Surface-specific hint builders read these bindings
 * by action id, so changing a chord here updates help/footer playback copy together.
 */

export type KeyScope =
  | "global"
  | "editing"
  | "browse"
  | "search"
  | "loading"
  | "library"
  | "player"
  | "postPlayback"
  | "queue"
  | "history"
  | "notifications";

export type KeyChord = {
  /** Printable trigger character, e.g. "/", "?", "n". Omit for pure named keys. */
  readonly input?: string;
  /** Named key from {@link LineEditorKey}, e.g. "escape", "return", "upArrow". */
  readonly named?: keyof LineEditorKey;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
};

export type KeyBinding = {
  readonly id: string;
  readonly chord: KeyChord;
  /** Intent label shown in help + footer (e.g. "Back", "Next episode"). */
  readonly label: string;
  /** Compact copy for dense hint rows, e.g. "next" instead of "Next episode". */
  readonly hintLabel?: string;
  readonly scope: KeyScope;
  /** Group heading for the `?` help overlay. */
  readonly group: string;
  /** Lower = more prominent in the footer hint row. Omit to keep out of the footer. */
  readonly footerPriority?: number;
  /** Override the rendered key label for composite hints, e.g. "↑↓", "Shift+Enter". */
  readonly display?: string;
  /**
   * Documentation-only entry: shown in help but never matched as live input here
   * (handled by another layer — the line editor, the list controller, or mpv).
   */
  readonly helpOnly?: boolean;
  /** Optional slash-command id for palette / footer / help parity. */
  readonly commandId?: AppCommandId;
};

export type KeyHint = {
  readonly keys: string;
  readonly label: string;
};

export type HelpSection = {
  readonly group: string;
  readonly items: readonly KeyHint[];
};

const NAMED_LABELS: Partial<Record<keyof LineEditorKey, string>> = {
  escape: "Esc",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Del",
  upArrow: "↑",
  downArrow: "↓",
  leftArrow: "←",
  rightArrow: "→",
  home: "Home",
  end: "End",
};

export const KEYBINDINGS: readonly KeyBinding[] = [
  // ── Global — reachable from every surface ──
  {
    id: "command-palette",
    chord: { input: "/" },
    label: "Open command palette",
    hintLabel: "commands",
    scope: "global",
    group: "Global",
    footerPriority: 20,
  },
  {
    id: "help",
    chord: { input: "?" },
    label: "Show this help",
    hintLabel: "help",
    scope: "global",
    group: "Global",
    footerPriority: 40,
    commandId: "help",
  },
  {
    id: "back",
    chord: { named: "escape" },
    label: "Back · close panel · clear filter",
    hintLabel: "back",
    scope: "global",
    group: "Global",
    footerPriority: 30,
  },
  {
    id: "quit",
    chord: { input: "c", ctrl: true },
    label: "Quit",
    hintLabel: "quit",
    scope: "global",
    group: "Global",
    footerPriority: 50,
  },

  // ── Editing — handled by the line editor; documented here, not matched ──
  {
    id: "edit-home-end",
    chord: { input: "a", ctrl: true },
    display: "Ctrl+A / E",
    label: "Jump to start / end of input",
    scope: "editing",
    group: "Editing",
    helpOnly: true,
  },
  {
    id: "edit-delete-word",
    chord: { input: "w", ctrl: true },
    label: "Delete word backward",
    scope: "editing",
    group: "Editing",
    helpOnly: true,
  },
  {
    id: "edit-word-move",
    chord: { named: "leftArrow", ctrl: true },
    display: "Ctrl+← / →",
    label: "Move cursor by word",
    scope: "editing",
    group: "Editing",
    helpOnly: true,
  },

  // ── Browse — list focused; arrow nav handled by the list controller ──
  {
    id: "browse-nav",
    chord: { named: "downArrow" },
    display: "↑↓",
    label: "Move through results",
    scope: "browse",
    group: "While browsing",
    helpOnly: true,
  },
  {
    id: "browse-open",
    chord: { named: "return" },
    label: "Open the highlighted title",
    hintLabel: "open",
    scope: "browse",
    group: "While browsing",
    footerPriority: 10,
  },
  {
    id: "browse-mode",
    chord: { named: "tab" },
    label: "Cycle catalog mode (series / anime / YouTube)",
    hintLabel: "mode",
    scope: "browse",
    group: "While browsing",
    footerPriority: 15,
  },
  {
    id: "browse-details",
    chord: { input: "i" },
    label: "Show title details",
    hintLabel: "details",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-details-ctrl",
    chord: { input: "o", ctrl: true },
    display: "Ctrl+O",
    label: "Show title details",
    hintLabel: "details",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-download",
    chord: { input: "d", ctrl: true },
    display: "Ctrl+D / d",
    label: "Download the highlighted title",
    hintLabel: "download",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-queue",
    chord: { input: "q" },
    label: "Add the highlighted title to Up Next",
    hintLabel: "up next",
    scope: "browse",
    group: "While browsing",
    commandId: "playlist-add",
  },
  {
    id: "browse-watchlist",
    chord: { input: "w" },
    label: "Add the highlighted title to Watchlist",
    hintLabel: "watchlist",
    scope: "browse",
    group: "While browsing",
    commandId: "bookmark",
  },
  {
    id: "browse-follow",
    chord: { input: "W", shift: true },
    display: "Shift+W",
    label: "Follow releases for the highlighted title",
    hintLabel: "follow",
    scope: "browse",
    group: "While browsing",
    commandId: "follow",
  },
  {
    id: "browse-trending",
    chord: { input: "t", ctrl: true },
    label: "Reload trending results",
    hintLabel: "trending",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-filter",
    chord: { input: "f", ctrl: true },
    label: "Focus the filter field",
    hintLabel: "filter",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-title-control-menu",
    chord: { input: "m" },
    label: "Open starting-point menu for the highlighted title (same as Enter)",
    hintLabel: "menu",
    scope: "browse",
    group: "While browsing",
    footerPriority: 18,
  },
  {
    id: "browse-title-control-menu-shift",
    chord: { input: "M", shift: true },
    display: "Shift+M",
    label: "Open starting-point menu (legacy; prefer m on the list)",
    hintLabel: "menu",
    scope: "browse",
    group: "While browsing",
    footerPriority: 19,
    helpOnly: true,
  },
  {
    id: "browse-notifications",
    chord: { input: "n", shift: true },
    display: "Shift+N",
    label: "Open notifications inbox",
    hintLabel: "inbox",
    scope: "browse",
    group: "While browsing",
    footerPriority: 22,
  },

  // ── In player — mpv window; mirrors kunai-bridge.lua ──
  {
    id: "player-stop",
    chord: { input: "q" },
    label: "Stop playback",
    hintLabel: "stop",
    scope: "player",
    group: "In the player",
    footerPriority: 5,
  },
  {
    id: "player-next",
    chord: { input: "n" },
    display: "n / N",
    label: "Next episode",
    hintLabel: "next",
    scope: "player",
    group: "In the player",
    footerPriority: 10,
  },
  {
    id: "player-previous",
    chord: { input: "p" },
    display: "p / P",
    label: "Previous episode",
    hintLabel: "prev",
    scope: "player",
    group: "In the player",
    footerPriority: 15,
  },
  {
    id: "player-fallback",
    // Deliberate chord: switching providers mid-session is disruptive, so it
    // must not fire from a stray keypress the way a bare `f` could.
    chord: { input: "F", shift: true },
    display: "Shift+F",
    label: "Switch to another provider (fallback)",
    hintLabel: "fallback",
    scope: "player",
    group: "In the player",
    footerPriority: 20,
  },
  {
    id: "player-source",
    chord: { input: "o" },
    label: "Choose source",
    hintLabel: "source",
    scope: "player",
    group: "In the player",
    footerPriority: 25,
  },
  {
    id: "player-episode",
    chord: { input: "e" },
    label: "Choose episode",
    hintLabel: "episodes",
    scope: "player",
    group: "In the player",
    footerPriority: 30,
  },
  {
    id: "player-skip",
    chord: { input: "b" },
    label: "Skip intro / recap / credits (when offered)",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-reload-subtitles",
    chord: { input: "s" },
    label: "Reload subtitles",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-return-search",
    chord: { input: "S" },
    display: "Shift+S",
    label: "Return to search",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-autoplay",
    chord: { input: "a" },
    label: "Toggle autoplay",
    hintLabel: "autoplay",
    scope: "player",
    group: "In the player",
    footerPriority: 35,
  },
  {
    id: "player-autoskip",
    chord: { input: "u" },
    label: "Toggle autoskip",
    hintLabel: "autoskip",
    scope: "player",
    group: "In the player",
    footerPriority: 40,
  },
  {
    id: "player-stop-after-current",
    chord: { input: "x" },
    label: "Stop after current episode",
    hintLabel: "stop after",
    scope: "player",
    group: "In the player",
    footerPriority: 45,
  },
  {
    id: "title-control-menu",
    chord: { input: "m" },
    label: "Open title control menu",
    hintLabel: "menu",
    scope: "player",
    group: "In the player",
    footerPriority: 28,
  },
  {
    id: "player-memory",
    chord: { input: "m" },
    display: "/memory",
    label: "Toggle memory panel",
    scope: "player",
    group: "In the player",
    helpOnly: true,
  },
  {
    id: "player-diagnostics",
    chord: { input: "d" },
    label: "Open diagnostics",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-quality",
    chord: { input: "k" },
    display: "k / K",
    label: "Choose quality (in the terminal; v in mpv)",
    hintLabel: "quality",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-refresh",
    chord: { input: "r", ctrl: true },
    label: "Refresh the stream (same episode)",
    scope: "player",
    group: "In the player",
  },
  {
    id: "player-resume-seek",
    chord: { input: "r", meta: true },
    display: "Alt+R",
    label: "Resume to your saved position",
    scope: "player",
    group: "In the player",
  },

  // ── Post-play — terminal footer ──
  {
    id: "post-continue",
    chord: { input: "n" },
    label: "Continue / next",
    hintLabel: "continue",
    scope: "postPlayback",
    group: "After playback",
    footerPriority: 10,
  },
  {
    id: "post-quit",
    chord: { input: "q" },
    label: "Quit post-playback",
    hintLabel: "quit",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-replay",
    chord: { input: "r" },
    label: "Replay this episode",
    hintLabel: "replay",
    scope: "postPlayback",
    group: "After playback",
    footerPriority: 15,
  },
  {
    id: "post-search",
    chord: { input: "s" },
    label: "Search for something else",
    hintLabel: "search",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-history",
    chord: { input: "h" },
    label: "Open history",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-watchlist",
    chord: { input: "w" },
    label: "Open your watchlist",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-fallback",
    chord: { input: "F", shift: true },
    display: "Shift+F",
    label: "Switch to another provider (fallback)",
    hintLabel: "fallback",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-source",
    chord: { input: "o" },
    label: "Choose source",
    hintLabel: "source",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-diagnostics",
    chord: { input: "d" },
    label: "Open diagnostics",
    hintLabel: "diagnostics",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-episode",
    chord: { input: "e" },
    label: "Choose episode",
    hintLabel: "episodes",
    scope: "postPlayback",
    group: "After playback",
  },
  {
    id: "post-title-control-menu",
    chord: { input: "m" },
    label: "Open title control menu",
    hintLabel: "menu",
    scope: "postPlayback",
    group: "After playback",
    footerPriority: 12,
  },
  {
    id: "post-play-recommendation",
    chord: { input: "1" },
    display: "1·2·3",
    label: "Play a recommended title now",
    scope: "postPlayback",
    group: "After playback",
    helpOnly: true,
  },

  // ── Up Next queue ──
  {
    id: "queue-open",
    chord: { input: "Q", shift: true },
    display: "Shift+Q",
    label: "Open Up Next",
    hintLabel: "up next",
    scope: "browse",
    group: "While browsing",
    footerPriority: 45,
    commandId: "up-next",
  },
  {
    id: "queue-play",
    chord: { named: "return" },
    label: "Play the selected item now",
    hintLabel: "play",
    scope: "queue",
    group: "Up Next",
    footerPriority: 10,
  },
  {
    id: "queue-reorder",
    chord: { input: "J" },
    display: "J / K",
    label: "Move item down / up one slot",
    hintLabel: "reorder",
    scope: "queue",
    group: "Up Next",
    footerPriority: 15,
  },
  {
    id: "queue-move-ends",
    chord: { input: "g" },
    display: "g / G",
    label: "Move to top (play next) / bottom",
    scope: "queue",
    group: "Up Next",
    footerPriority: 20,
  },
  {
    id: "queue-remove",
    chord: { input: "x" },
    label: "Remove the selected item",
    hintLabel: "remove",
    scope: "queue",
    group: "Up Next",
    footerPriority: 25,
  },
  {
    id: "queue-clear",
    chord: { input: "c" },
    display: "c / C",
    label: "Clear queue / clear played",
    hintLabel: "clear",
    scope: "queue",
    group: "Up Next",
    footerPriority: 28,
  },
  {
    id: "queue-restore",
    chord: { input: "r" },
    label: "Restore your last queue",
    hintLabel: "restore",
    scope: "queue",
    group: "Up Next",
    footerPriority: 30,
  },

  // ── History ──
  {
    id: "history-resume",
    chord: { named: "return" },
    label: "Resume the highlighted title",
    hintLabel: "resume",
    scope: "history",
    group: "History",
    footerPriority: 10,
  },
  {
    id: "history-queue",
    chord: { input: "q" },
    label: "Add the highlighted title to Up Next",
    hintLabel: "up next",
    scope: "history",
    group: "History",
    footerPriority: 15,
    commandId: "playlist-add",
  },
  {
    id: "history-tab",
    chord: { named: "tab" },
    display: "Tab · Shift+Tab",
    label: "Cycle history tabs (Shift reverses)",
    hintLabel: "tabs",
    scope: "history",
    group: "History",
    footerPriority: 20,
  },
  {
    id: "history-type-filter",
    chord: { named: "leftArrow" },
    display: "←→",
    label: "Cycle type filter (← reverse, → forward)",
    hintLabel: "filter",
    scope: "history",
    group: "History",
    helpOnly: true,
  },

  // ── Notifications ──
  {
    id: "notifications-action",
    chord: { named: "return" },
    label: "Run the primary notification action",
    hintLabel: "action",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 10,
  },
  {
    id: "notifications-all-actions",
    chord: { input: "a" },
    label: "Open all notification actions",
    hintLabel: "actions",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 12,
  },
  {
    id: "notifications-sort",
    chord: { input: "s" },
    label: "Cycle notification sort",
    hintLabel: "sort",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 14,
  },
  {
    id: "notifications-mark-read",
    chord: { input: "r" },
    label: "Mark selected notification as read",
    hintLabel: "read",
    scope: "notifications",
    group: "Notifications",
    helpOnly: true,
  },
  {
    id: "notifications-delete",
    chord: { input: "d" },
    label: "Delete selected notification",
    hintLabel: "delete",
    scope: "notifications",
    group: "Notifications",
    helpOnly: true,
  },
  {
    id: "notifications-mark-all",
    chord: { input: "A" },
    display: "A",
    label: "Mark all notifications as read",
    hintLabel: "read all",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 15,
    helpOnly: true,
  },
  {
    id: "notifications-archive",
    chord: { input: "x" },
    label: "Archive the selected notification",
    hintLabel: "archive",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 20,
    helpOnly: true,
  },
  {
    id: "notifications-clear",
    chord: { input: "C" },
    display: "C",
    label: "Clear archived notifications",
    hintLabel: "clear",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 25,
    helpOnly: true,
  },
  {
    id: "notifications-page",
    chord: { input: "[" },
    display: "[ / ]",
    label: "Previous / next page",
    hintLabel: "page",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 28,
    helpOnly: true,
  },
  {
    id: "notifications-tab",
    chord: { named: "tab" },
    label: "Switch Active / Archive",
    hintLabel: "switch",
    scope: "notifications",
    group: "Notifications",
    footerPriority: 30,
  },

  // ── Loading — playback bootstrap surface ──
  {
    id: "loading-title-control-menu",
    chord: { input: "m" },
    label: "Open title control menu",
    hintLabel: "menu",
    scope: "loading",
    group: "While loading",
    footerPriority: 12,
  },
  {
    id: "loading-settings",
    chord: { input: "g" },
    label: "Open settings",
    hintLabel: "settings",
    scope: "loading",
    group: "While loading",
    footerPriority: 40,
  },
  {
    id: "loading-history",
    chord: { input: "h" },
    label: "Open history",
    hintLabel: "history",
    scope: "loading",
    group: "While loading",
    footerPriority: 42,
  },

  // ── Library ──
  {
    id: "library-open",
    chord: { named: "return" },
    label: "Open selected title",
    hintLabel: "open",
    scope: "library",
    group: "In the library",
    footerPriority: 10,
  },
  {
    id: "library-delete",
    chord: { input: "x" },
    label: "Delete offline title",
    hintLabel: "delete",
    scope: "library",
    group: "In the library",
    footerPriority: 15,
  },
  {
    id: "library-protect",
    chord: { input: "p" },
    label: "Toggle cleanup protection",
    hintLabel: "protect",
    scope: "library",
    group: "In the library",
    footerPriority: 20,
  },
  {
    id: "library-tab",
    chord: { named: "tab" },
    label: "Switch Library / Up Next",
    hintLabel: "Tab → Up Next",
    scope: "library",
    group: "In the library",
    footerPriority: 25,
  },
  {
    id: "library-title-control-menu",
    chord: { input: "m" },
    label: "Open title control menu",
    hintLabel: "menu",
    scope: "library",
    group: "In the library",
    footerPriority: 30,
  },
];

/** First binding linked to a slash-command id (if any). */
export function bindingForCommand(commandId: AppCommandId): KeyBinding | undefined {
  return KEYBINDINGS.find((binding) => binding.commandId === commandId);
}

/** All bindings linked to a slash-command id. */
export function bindingsForCommand(commandId: AppCommandId): readonly KeyBinding[] {
  return KEYBINDINGS.filter((binding) => binding.commandId === commandId);
}

/** Slash-command id linked to a binding, when declared. */
export function commandForBinding(bindingId: string): AppCommandId | undefined {
  return KEYBINDINGS.find((binding) => binding.id === bindingId)?.commandId;
}

/** Live bindings in a scope that declare a command id. */
export function commandBackedBindingsForScope(scope: KeyScope): readonly KeyBinding[] {
  return bindingsForScope(scope).filter(
    (binding) => binding.commandId !== undefined && !binding.helpOnly,
  );
}

/** Human-readable chord, e.g. "Esc", "↑", "/", "Ctrl+C". */
export function formatChord(chord: KeyChord): string {
  const modifiers: string[] = [];
  if (chord.ctrl) modifiers.push("Ctrl");
  if (chord.meta) modifiers.push("Alt");
  if (chord.shift) modifiers.push("Shift");
  const base = chord.named
    ? (NAMED_LABELS[chord.named] ?? chord.named)
    : formatPrintable(chord.input ?? "", modifiers.length > 0);
  return [...modifiers, base].join("+");
}

function formatPrintable(input: string, hasModifier: boolean): string {
  if (hasModifier && /^[a-z]$/.test(input)) return input.toUpperCase();
  return input;
}

/** Rendered key label for a binding — its display override, else its formatted chord. */
export function bindingKeys(binding: KeyBinding): string {
  return binding.display ?? formatChord(binding.chord);
}

function matchChord(chord: KeyChord, input: string, key: LineEditorKey): boolean {
  if (chord.ctrl ? key.ctrl !== true : key.ctrl === true) return false;
  if (chord.meta ? key.meta !== true : key.meta === true) return false;
  if (chord.shift ? key.shift !== true : false) return false;
  if (chord.named) return key[chord.named] === true;
  return chord.input !== undefined && input === chord.input;
}

function globalBindings(): readonly KeyBinding[] {
  return KEYBINDINGS.filter((binding) => binding.scope === "global");
}

function scopedBindings(scope: KeyScope): readonly KeyBinding[] {
  return KEYBINDINGS.filter((binding) => binding.scope === scope);
}

/**
 * Bindings visible on a surface: scope-specific first, then global, with a scope
 * binding overriding a global one that shares the same chord (so a surface can
 * re-purpose a key without offering it twice).
 */
export function bindingsForScope(scope: KeyScope): readonly KeyBinding[] {
  if (scope === "global") return globalBindings();
  const scoped = scopedBindings(scope);
  const taken = new Set(scoped.map((binding) => bindingKeys(binding)));
  const inherited = globalBindings().filter((binding) => !taken.has(bindingKeys(binding)));
  return [...scoped, ...inherited];
}

/**
 * First live (non-helpOnly) binding whose chord matches the input on this surface,
 * or null. Documentation-only entries are skipped — those keys are matched by the
 * layer that actually owns them (line editor, list controller, mpv).
 */
export function matchBinding(
  scope: KeyScope,
  input: string,
  key: LineEditorKey,
): KeyBinding | null {
  for (const binding of bindingsForScope(scope)) {
    if (binding.helpOnly) continue;
    if (matchChord(binding.chord, input, key)) return binding;
  }
  return null;
}

export type FooterBindingsContext = {
  /** Binding ids to include, in order. Defaults to footer-priority bindings for the scope. */
  readonly ids?: readonly string[];
  /** Map binding id → dispatchable shell action (browse/post-play footers). */
  readonly actions?: Partial<Record<string, ShellAction>>;
  /** Per-binding overrides for keys, labels, primary state, or actions. */
  readonly overrides?: Partial<
    Record<
      string,
      {
        readonly key?: string;
        readonly label?: string;
        readonly primary?: boolean;
        readonly action?: ShellAction;
      }
    >
  >;
  /** Append `/ commands` + `esc close` (default true). */
  readonly tail?: boolean;
  readonly tailCloseLabel?: string;
};

/** Rendered footer key for a binding — preserves display overrides such as `J / K`. */
export function footerKeyFromBinding(binding: KeyBinding): string {
  if (binding.display) return binding.display;
  if (binding.chord.named === "return") return "enter";
  return formatChord(binding.chord).toLowerCase();
}

/** Build structured footer actions from the keybinding registry for a scope. */
export function buildFooterActionsFromBindings(
  scope: KeyScope,
  ctx: FooterBindingsContext = {},
): readonly FooterAction[] {
  const scopeBindings = bindingsForScope(scope);
  const byId = new Map(scopeBindings.map((binding) => [binding.id, binding]));
  const selected = ctx.ids
    ? ctx.ids
        .map((id) => byId.get(id) ?? KEYBINDINGS.find((binding) => binding.id === id))
        .filter((binding): binding is KeyBinding => binding !== undefined)
    : scopeBindings
        .filter((binding) => binding.footerPriority !== undefined && !binding.helpOnly)
        .sort((a, b) => (a.footerPriority ?? 0) - (b.footerPriority ?? 0));

  const actions: FooterAction[] = selected.map((binding) => {
    const override = ctx.overrides?.[binding.id];
    return {
      key: override?.key ?? footerKeyFromBinding(binding),
      label: override?.label ?? binding.hintLabel ?? binding.label,
      action: override?.action ?? ctx.actions?.[binding.id],
      primary: override?.primary,
    };
  });

  if (ctx.tail === false) return actions;

  const commandPalette = KEYBINDINGS.find((binding) => binding.id === "command-palette");
  const back = KEYBINDINGS.find((binding) => binding.id === "back");
  actions.push({
    key: commandPalette ? footerKeyFromBinding(commandPalette) : "/",
    label: commandPalette?.hintLabel ?? "commands",
    action: "command-mode",
  });
  actions.push({
    key: back ? footerKeyFromBinding(back) : "esc",
    label: ctx.tailCloseLabel ?? "close",
    action: "quit",
  });
  return actions;
}

/** Footer hints for a surface, ordered by priority, optionally capped. */
export function footerHints(scope: KeyScope, max?: number): readonly KeyHint[] {
  const hints = bindingsForScope(scope)
    .filter((binding) => binding.footerPriority !== undefined && !binding.helpOnly)
    .sort((a, b) => (a.footerPriority ?? 0) - (b.footerPriority ?? 0))
    .map((binding) => ({ keys: bindingKeys(binding), label: binding.hintLabel ?? binding.label }));
  return max === undefined ? hints : hints.slice(0, max);
}

/** Group a set of bindings into help sections, preserving first-seen group order. */
function groupHelpSections(bindings: readonly KeyBinding[]): readonly HelpSection[] {
  const order: string[] = [];
  const byGroup = new Map<string, KeyHint[]>();
  for (const binding of bindings) {
    if (!byGroup.has(binding.group)) {
      byGroup.set(binding.group, []);
      order.push(binding.group);
    }
    byGroup.get(binding.group)?.push({ keys: bindingKeys(binding), label: binding.label });
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}

/** All bindings grouped by their help group, in registry order, for the `?` overlay. */
export function helpSections(): readonly HelpSection[] {
  return groupHelpSections(KEYBINDINGS);
}

/**
 * Context-aware help: only the chords that apply on `scope` (its own plus the
 * inherited globals via {@link bindingsForScope}), grouped for the `?` overlay.
 * Drops irrelevant surfaces so the overlay reads as "what can I do here" rather
 * than the whole registry. `helpOnly` entries are kept — they document keys
 * owned by another layer (line editor / list / mpv) that are still live here.
 */
export function helpSectionsForScope(scope: KeyScope): readonly HelpSection[] {
  return groupHelpSections(bindingsForScope(scope));
}
