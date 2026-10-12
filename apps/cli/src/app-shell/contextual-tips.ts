// =============================================================================
// Contextual tips — shell half
//
// Domain owns trigger → tip matching (`domain/session/contextual-tips`). This
// module owns the three things the shell contributes:
//
//   - copy: binding id → the real rendered key → the one-line `tip:` string
//   - arming: `notePaletteCommand` runs the gates (enabled, once-ever, no
//     overlay owns focus), persists the seen id, then emits the line
//   - delivery: a single listener the root shell registers; the line lands on
//     the same transient row toasts and kanna lines already use
// =============================================================================

import type { Container } from "@/container";
import type { AppCommandId } from "@/domain/session/command-registry";
import {
  CONTEXTUAL_TIPS,
  contextualTipEligible,
  contextualTipForCommand,
  type ContextualTip,
  type ContextualTipSurface,
} from "@/domain/session/contextual-tips";

import { bindingKeys, KEYBINDINGS } from "./keybindings";

/**
 * The one-line hint for a tip, or null when the tip names a binding id that no
 * longer exists — a renamed binding must never render a dangling `tip: `.
 */
export function contextualTipLine(tip: ContextualTip): string | null {
  if (tip.bindingId === undefined) return `tip: ${tip.teach}`;
  const binding = KEYBINDINGS.find((candidate) => candidate.id === tip.bindingId);
  if (!binding) return null;
  return `tip: ${bindingKeys(binding)} ${tip.teach}`;
}

type ContextualTipListener = (line: string) => void;

let tipListener: ContextualTipListener | null = null;

/** The root shell registers one line sink; surfaces only arm, never render. */
export function setContextualTipListener(listener: ContextualTipListener | null): void {
  tipListener = listener;
}

/**
 * Called when the user picks a command out of the `/` palette — the exact
 * "did it the long way" moment. Bound per surface with its tip surface so the
 * shortcut being taught is one that actually works there.
 *
 * Gates run in this order: a tip exists for the command in this context →
 * tips are enabled → no overlay or picker owns focus → the id is unseen. The
 * seen id is persisted before the line emits, so a crash between the two can
 * only ever cost a tip, never repeat one.
 */
export function notePaletteCommand(
  container: Container,
  surface: ContextualTipSurface,
  commandId: AppCommandId,
): void {
  const tip = contextualTipForCommand(commandId, surface);
  if (!tip) return;

  const config = container.config;
  const overlayOpen = container.stateManager.getState().activeModals.length > 0;
  if (
    !contextualTipEligible(tip, {
      tipsEnabled: config.tipsEnabled,
      seenTips: config.seenTips,
      overlayOpen,
    })
  ) {
    return;
  }

  const line = contextualTipLine(tip);
  if (!line) return;

  // update() is memory-only; save() is what makes the tip once-ever across
  // restarts. Fire-and-forget matches how other shell-owned config writes go.
  void config
    .update({ seenTips: [...config.seenTips, tip.id] })
    .then(() => config.save())
    .catch(() => undefined);

  tipListener?.(line);
}

export type ContextualTipCatalogEntry = {
  readonly id: string;
  readonly line: string;
  readonly seen: boolean;
};

/** Every tip with its rendered line and seen state — the settings "see all" row. */
export function contextualTipCatalog(
  seenTips: readonly string[],
): readonly ContextualTipCatalogEntry[] {
  return CONTEXTUAL_TIPS.flatMap((tip) => {
    const line = contextualTipLine(tip);
    if (!line) return [];
    return [{ id: tip.id, line, seen: seenTips.includes(tip.id) }];
  });
}
