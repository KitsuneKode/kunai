/**
 * Outcome of one row click. `priorKey` is what the caller stores for the next
 * click: the clicked row after a select, nothing after an activation.
 */
export type PointerClickIntent =
  | { readonly intent: "select"; readonly priorKey: string }
  | { readonly intent: "activate"; readonly priorKey: null };

/**
 * First click on a row selects it. A second click on that same selected row
 * activates it. A preselected row still needs the first click.
 */
export function pointerClickIntent(
  priorKey: string | null,
  key: string,
  selected: boolean,
): PointerClickIntent {
  if (!selected || priorKey !== key) {
    return { intent: "select", priorKey: key } satisfies PointerClickIntent;
  }
  return { intent: "activate", priorKey: null } satisfies PointerClickIntent;
}
