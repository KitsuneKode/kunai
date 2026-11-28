/**
 * Declarative Escape-key back stack for shell surfaces.
 *
 * Surfaces declare the layers they currently own; this module is the single
 * place where their priority is encoded. The order follows the shell-v4 Esc
 * ladder: destructive confirmation first, then prompts, query state, nested
 * sheets, pickers, surface-local state, overlays, and finally route history.
 */
export type EscLayer =
  | { readonly kind: "confirm" }
  | { readonly kind: "prompt" }
  | { readonly kind: "picker" }
  | { readonly kind: "nested-pane" }
  | { readonly kind: "filter"; readonly query: string }
  | { readonly kind: "surface-owned" }
  | { readonly kind: "overlay" }
  | { readonly kind: "route" };

export type EscAction =
  | "cancel-confirmation"
  | "cancel-prompt"
  | "cancel-picker"
  | "exit-pane"
  | "clear-filter"
  | "defer-to-surface"
  | "close-overlay"
  | "back-route"
  | "no-op";

const ESC_LAYER_PRIORITY = [
  "confirm",
  "prompt",
  "filter",
  "nested-pane",
  "picker",
  "surface-owned",
  "overlay",
  "route",
] as const satisfies readonly EscLayer["kind"][];

const ESC_ACTION_BY_KIND = {
  confirm: "cancel-confirmation",
  prompt: "cancel-prompt",
  filter: "clear-filter",
  "nested-pane": "exit-pane",
  picker: "cancel-picker",
  "surface-owned": "defer-to-surface",
  overlay: "close-overlay",
  route: "back-route",
} as const satisfies Record<EscLayer["kind"], EscAction>;

function layerIsActive(layer: EscLayer): boolean {
  // An empty filter query is not an Escape layer; there is nothing to clear.
  return layer.kind !== "filter" || layer.query.length > 0;
}

/**
 * Resolve one Escape press against the declared layers.
 *
 * `cancelActive: false` means a line editor currently owns broad cancellation.
 * Even then, an armed destructive confirmation stays cancellable: leaving it
 * armed while Escape is swallowed is the unsafe case this stack exists to
 * prevent. All lower layers defer to the editor.
 */
export function resolveEscStack(
  layers: readonly EscLayer[],
  options?: { readonly cancelActive?: boolean },
): EscAction {
  const activeLayers = layers.filter(layerIsActive);
  for (const kind of ESC_LAYER_PRIORITY) {
    const layer = activeLayers.find((candidate) => candidate.kind === kind);
    if (!layer) continue;
    if (options?.cancelActive === false && kind !== "confirm") return "no-op";
    return ESC_ACTION_BY_KIND[kind];
  }
  return "no-op";
}
