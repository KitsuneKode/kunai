/**
 * The keys that talk to Kanna, and where they must not.
 *
 * Plain letters, because a modifier chord would collide with the browser and with the
 * docs' own `Ctrl K` search, and plain letters are safe only if they are never taken
 * from someone who is typing. So a key is ignored when any modifier is held (a
 * shortcut for something else), when focus is in anything that takes text, and when
 * it was the auto-repeat of a held key. Nothing here calls `preventDefault`: she is
 * decoration, and a key that meant something else must still mean it.
 *
 * Pure so the rules are tested without a browser.
 */

export type KannaCommand = "stay" | "come" | "nap";

export const KANNA_KEYS = {
  s: "stay",
  c: "come",
  n: "nap",
} as const satisfies Record<string, KannaCommand>;

/** What a key press needs to say for the rules to judge it. */
export type KeyPress = {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
};

/** The element the key landed on, reduced to what decides whether it is text entry. */
export type KeyTarget = {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  /** True when the element is inside an open dialog (search, a menu). */
  readonly inDialog: boolean;
};

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTextEntry(target: KeyTarget | null): boolean {
  if (!target) return false;
  return (
    target.isContentEditable || TEXT_ENTRY.has(target.tagName.toUpperCase()) || target.inDialog
  );
}

/** The command a key press means, or null when it must be left alone. */
export function commandForKey(press: KeyPress, target: KeyTarget | null): KannaCommand | null {
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey || press.repeat) return null;
  if (isTextEntry(target)) return null;
  const key = press.key.toLowerCase();
  if (key !== press.key) return null;
  return key === "s" || key === "c" || key === "n" ? KANNA_KEYS[key] : null;
}
