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
