import type { LineEditorKey } from "@/app-shell/line-editor";

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
  | "player"
  | "postPlayback"
  | "queue";

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
    label: "Switch series / anime mode",
    hintLabel: "mode",
    scope: "browse",
    group: "While browsing",
    footerPriority: 15,
  },
  {
    id: "browse-details",
    chord: { input: "i" },
    label: "Show title details",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-download",
    chord: { input: "d", ctrl: true },
    display: "Ctrl+D / d",
    label: "Download the highlighted title",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-queue",
    chord: { input: "q" },
    label: "Add the highlighted title to the queue",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-trending",
    chord: { input: "t", ctrl: true },
    label: "Reload trending results",
    scope: "browse",
    group: "While browsing",
  },
  {
    id: "browse-filter",
    chord: { input: "f", ctrl: true },
    label: "Focus the filter field",
    scope: "browse",
    group: "While browsing",
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
    chord: { input: "f" },
    label: "Fallback to another provider",
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
    id: "player-memory",
    chord: { input: "m" },
    label: "Toggle memory panel",
    scope: "player",
    group: "In the player",
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
    chord: { input: "f" },
    label: "Fallback to another provider",
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
    label: "Open the Up Next queue",
    scope: "browse",
    group: "While browsing",
    footerPriority: 45,
  },
  {
    id: "queue-play",
    chord: { named: "return" },
    label: "Play the selected item now",
    scope: "queue",
    group: "Up Next",
    footerPriority: 10,
  },
  {
    id: "queue-reorder",
    chord: { input: "J" },
    display: "J / K",
    label: "Move item down / up one slot",
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
    scope: "queue",
    group: "Up Next",
    footerPriority: 25,
  },
  {
    id: "queue-clear",
    chord: { input: "c" },
    display: "c / C",
    label: "Clear queue / clear played",
    scope: "queue",
    group: "Up Next",
  },
  {
    id: "queue-restore",
    chord: { input: "r" },
    label: "Restore your last queue",
    scope: "queue",
    group: "Up Next",
  },
];

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

/** Footer hints for a surface, ordered by priority, optionally capped. */
export function footerHints(scope: KeyScope, max?: number): readonly KeyHint[] {
  const hints = bindingsForScope(scope)
    .filter((binding) => binding.footerPriority !== undefined && !binding.helpOnly)
    .sort((a, b) => (a.footerPriority ?? 0) - (b.footerPriority ?? 0))
    .map((binding) => ({ keys: bindingKeys(binding), label: binding.hintLabel ?? binding.label }));
  return max === undefined ? hints : hints.slice(0, max);
}

/** All bindings grouped by their help group, in registry order, for the `?` overlay. */
export function helpSections(): readonly HelpSection[] {
  const order: string[] = [];
  const byGroup = new Map<string, KeyHint[]>();
  for (const binding of KEYBINDINGS) {
    if (!byGroup.has(binding.group)) {
      byGroup.set(binding.group, []);
      order.push(binding.group);
    }
    byGroup.get(binding.group)?.push({ keys: bindingKeys(binding), label: binding.label });
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}
