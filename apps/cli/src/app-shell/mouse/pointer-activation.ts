/**
 * First click on a row selects it. A second click on that same selected row
 * activates it. A preselected row still needs the first click.
 */
export function pointerClickIntent(
  priorKey: string | null,
  key: string,
  selected: boolean,
): { readonly intent: "select" | "activate"; readonly priorKey: string | null } {
  if (!selected || priorKey !== key) {
    return { intent: "select", priorKey: key };
  }
  return { intent: "activate", priorKey: null };
}
