import type { LineEditorKey } from "@/app-shell/line-editor";

/**
 * Single source of truth for raw key chords (Esc / arrows / Enter / `/` / `?` …),
 * distinct from the slash-command registry in `domain/session/command-registry`
 * (which owns `/command` palette entries). Surfaces match input through
 * {@link matchBinding}, the footer-hint row reads {@link footerHints}, and the `?`
 * overlay reads {@link helpSections} — so hints and help can never drift from the
 * bindings that actually fire.
 */

export type KeyScope = "global" | "list" | "search" | "playback" | "postPlayback";

export type KeyChord = {
  /** Printable trigger character, e.g. "/", "?", "n". Omit for pure named keys. */
  readonly input?: string;
  /** Named key from {@link LineEditorKey}, e.g. "escape", "return", "upArrow". */
  readonly named?: keyof LineEditorKey;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
};

export type KeyBinding = {
  readonly id: string;
  readonly chord: KeyChord;
  /** Intent label shown in help + footer (e.g. "Back", "Next episode"). */
  readonly label: string;
  readonly scope: KeyScope;
  /** Lower = more prominent in the footer hint row. Omit to keep out of the footer. */
  readonly footerPriority?: number;
  /** Group heading for the `?` help overlay. */
  readonly group: string;
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
  // Global — reachable from every surface.
  {
    id: "command-palette",
    chord: { input: "/" },
    label: "Commands",
    scope: "global",
    group: "Global",
    footerPriority: 20,
  },
  {
    id: "back",
    chord: { named: "escape" },
    label: "Back",
    scope: "global",
    group: "Global",
    footerPriority: 30,
  },
  {
    id: "help",
    chord: { input: "?" },
    label: "Help",
    scope: "global",
    group: "Global",
    footerPriority: 40,
  },
  {
    id: "quit",
    chord: { input: "c", ctrl: true },
    label: "Quit",
    scope: "global",
    group: "Global",
    footerPriority: 50,
  },

  // Lists / pickers (browse, history, library, discover, episode pickers).
  {
    id: "list-select",
    chord: { named: "return" },
    label: "Open",
    scope: "list",
    group: "Lists",
    footerPriority: 10,
  },
  { id: "list-up", chord: { named: "upArrow" }, label: "Move up", scope: "list", group: "Lists" },
  {
    id: "list-down",
    chord: { named: "downArrow" },
    label: "Move down",
    scope: "list",
    group: "Lists",
  },

  // Search field.
  {
    id: "search-submit",
    chord: { named: "return" },
    label: "Search",
    scope: "search",
    group: "Search",
    footerPriority: 10,
  },

  // During playback.
  {
    id: "playback-next",
    chord: { input: "n" },
    label: "Next episode",
    scope: "playback",
    group: "Playback",
    footerPriority: 10,
  },
  {
    id: "playback-replay",
    chord: { input: "r" },
    label: "Replay",
    scope: "playback",
    group: "Playback",
    footerPriority: 15,
  },

  // Post-play surface.
  {
    id: "post-next",
    chord: { input: "n" },
    label: "Next",
    scope: "postPlayback",
    group: "Post-play",
    footerPriority: 10,
  },
  {
    id: "post-replay",
    chord: { input: "r" },
    label: "Replay",
    scope: "postPlayback",
    group: "Post-play",
    footerPriority: 15,
  },
];

/** Human-readable chord, e.g. "Esc", "↑", "/", "Ctrl+C". */
export function formatChord(chord: KeyChord): string {
  const modifiers: string[] = [];
  if (chord.ctrl) modifiers.push("Ctrl");
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

function matchChord(chord: KeyChord, input: string, key: LineEditorKey): boolean {
  if (chord.ctrl ? key.ctrl !== true : key.ctrl === true) return false;
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
 * Bindings visible on a surface: scope-specific first, then global, with a
 * scope binding overriding a global one that shares the same chord (so a surface
 * can re-purpose a key without offering it twice).
 */
export function bindingsForScope(scope: KeyScope): readonly KeyBinding[] {
  if (scope === "global") return globalBindings();
  const scoped = scopedBindings(scope);
  const taken = new Set(scoped.map((binding) => formatChord(binding.chord)));
  const inherited = globalBindings().filter((binding) => !taken.has(formatChord(binding.chord)));
  return [...scoped, ...inherited];
}

/** First binding whose chord matches the input on this surface, or null. */
export function matchBinding(
  scope: KeyScope,
  input: string,
  key: LineEditorKey,
): KeyBinding | null {
  for (const binding of bindingsForScope(scope)) {
    if (matchChord(binding.chord, input, key)) return binding;
  }
  return null;
}

/** Footer hints for a surface, ordered by priority, optionally capped. */
export function footerHints(scope: KeyScope, max?: number): readonly KeyHint[] {
  const hints = bindingsForScope(scope)
    .filter((binding) => binding.footerPriority !== undefined)
    .sort((a, b) => (a.footerPriority ?? 0) - (b.footerPriority ?? 0))
    .map((binding) => ({ keys: formatChord(binding.chord), label: binding.label }));
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
    byGroup.get(binding.group)?.push({ keys: formatChord(binding.chord), label: binding.label });
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}
