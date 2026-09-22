/**
 * Shared wait-predicate grammar for the agent drivers: `/pattern/` wait text
 * compiles to a RegExp (alternation, character classes); anything else is a
 * literal substring. Frames contain newlines — use `[\s\S]` to span lines.
 */
export function frameMatcher(needle: string): (frame: string) => boolean {
  const inner = /^\/(.+)\/$/.exec(needle)?.[1];
  if (inner === undefined) return (frame) => frame.includes(needle);
  const re = new RegExp(inner);
  return (frame) => re.test(frame);
}

/**
 * The surface's advertised key contract — the `[x] label` hints in footers and
 * headers. Extracted mechanically so a key plan is built from what the surface
 * claims to support, not guessed.
 */
export function advertisedKeys(frame: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of frame.matchAll(/\[([^\]\n]{1,24})\]/g)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}
