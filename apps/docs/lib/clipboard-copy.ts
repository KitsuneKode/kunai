/**
 * The copy decision, separated from the button that triggers it.
 *
 * Extracted because the interesting behaviour is a failure path: the clipboard
 * write genuinely rejects — no clipboard API, an insecure context, a denied
 * permission — and a button that reports "Copied" for a clipboard that never
 * received the text is lying to the reader. The docs test harness renders with
 * `renderToStaticMarkup` and has no DOM, so this cannot be covered through the
 * component; injecting the two effects is what makes it testable at all.
 *
 * `announce` fires only after a settled write, and only once, on whichever
 * branch handled the copy. The callback shape used to return before reaching
 * it, so a caller passing `onCopy` got no announcement at all.
 */
export type ClipboardCopyEffects = {
  /** The clipboard write. Rejects the way `navigator.clipboard` rejects. */
  readonly writeText: (text: string) => Promise<void>;
  /** Called once, only after a successful write. */
  readonly announce: (label: string) => void;
  /** The caller's own success handling — local state, or a supplied callback. */
  readonly onCopied: () => void;
};

/**
 * Write `text`, then announce it.
 *
 * Returns whether the clipboard actually took the text, so a caller can tell a
 * silent failure from a success without inspecting its own state.
 */
export async function copyAndAnnounce(
  text: string,
  label: string,
  effects: ClipboardCopyEffects,
): Promise<boolean> {
  try {
    await effects.writeText(text);
  } catch {
    return false;
  }

  effects.onCopied();
  effects.announce(label);
  return true;
}
