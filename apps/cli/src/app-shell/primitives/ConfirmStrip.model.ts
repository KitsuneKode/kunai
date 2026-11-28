import type { FooterAction } from "../types";

export type ConfirmStripState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "armed";
      readonly targetId: string;
      readonly label: string;
      readonly verb: string;
      readonly executingLabel?: string;
      readonly orderKey: string;
    }
  | {
      readonly kind: "executing";
      readonly targetId: string;
      readonly label: string;
      readonly verb: string;
      readonly executingLabel?: string;
    }
  | {
      readonly kind: "failed";
      readonly targetId: string;
      readonly label: string;
      readonly verb: string;
      readonly executingLabel?: string;
      readonly message: string;
    };

export type ConfirmStripAction =
  | {
      readonly type: "arm";
      readonly targetId: string;
      readonly label: string;
      readonly verb: string;
      readonly executingLabel?: string;
      readonly visibleIds: readonly string[];
    }
  | { readonly type: "confirm" }
  | { readonly type: "cancel" }
  | { readonly type: "succeed" }
  | { readonly type: "fail"; readonly message: string }
  | { readonly type: "reconcile"; readonly visibleIds: readonly string[] };

export type ConfirmStripEffect = {
  readonly type: "execute";
  readonly targetId: string;
  readonly label: string;
  readonly verb: string;
};

export type ConfirmStripTransition = {
  readonly state: ConfirmStripState;
  readonly effect?: ConfirmStripEffect;
};

export const idleConfirmStripState: ConfirmStripState = { kind: "idle" };

function confirmStripOrderKey(visibleIds: readonly string[]): string {
  return JSON.stringify(visibleIds);
}

/**
 * Pure destructive-confirmation state machine.
 *
 * The machine never executes side effects itself. `confirm` enters
 * `executing` and returns the immutable target snapshot as an effect; the
 * owning surface performs the delete and then reports `succeed` or `fail`.
 * Row identity is stable and ID-keyed — selection indexes never cross this
 * boundary.
 */
export function transitionConfirmStrip(
  state: ConfirmStripState,
  action: ConfirmStripAction,
): ConfirmStripTransition {
  switch (action.type) {
    case "arm": {
      if (state.kind === "executing") return { state };
      if (!action.targetId || action.targetId.length === 0) return { state };
      return {
        state: {
          kind: "armed",
          targetId: action.targetId,
          label: action.label,
          verb: action.verb,
          executingLabel: action.executingLabel,
          orderKey: confirmStripOrderKey(action.visibleIds),
        },
      };
    }
    case "confirm": {
      if (state.kind !== "armed") return { state };
      const nextState: ConfirmStripState = {
        kind: "executing",
        targetId: state.targetId,
        label: state.label,
        verb: state.verb,
        executingLabel: state.executingLabel,
      };
      return {
        state: nextState,
        effect: {
          type: "execute",
          targetId: state.targetId,
          label: state.label,
          verb: state.verb,
        },
      };
    }
    case "cancel":
      if (state.kind === "armed" || state.kind === "failed") {
        return { state: idleConfirmStripState };
      }
      return { state };
    case "succeed":
      if (state.kind !== "executing") return { state };
      return { state: idleConfirmStripState };
    case "fail":
      if (state.kind !== "executing") return { state };
      return {
        state: {
          kind: "failed",
          targetId: state.targetId,
          label: state.label,
          verb: state.verb,
          executingLabel: state.executingLabel,
          message: action.message,
        },
      };
    case "reconcile": {
      if (state.kind !== "armed") return { state };
      const visible = action.visibleIds;
      if (!visible.includes(state.targetId) || confirmStripOrderKey(visible) !== state.orderKey) {
        return { state: idleConfirmStripState };
      }
      return { state };
    }
  }
}

export function reduceConfirmStrip(
  state: ConfirmStripState,
  action: ConfirmStripAction,
): ConfirmStripState {
  return transitionConfirmStrip(state, action).state;
}

/** Test/helper for constructing an order key from actual row ids. */
export function confirmStripVisibleOrderKey(visibleIds: readonly string[]): string {
  return confirmStripOrderKey(visibleIds);
}

/** Whether the confirmation focus owns the surface's keyboard input. */
export function confirmStripOwnsInput(state: ConfirmStripState): boolean {
  return state.kind !== "idle";
}

/**
 * Plain `y` only. Ink reports Ctrl+Y as `"y"` with `ctrl` set, and that chord
 * is the line editor's yank — it must not confirm a destructive action.
 */
export function isPlainConfirmKey(
  input: string,
  key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly shift?: boolean },
): boolean {
  if (key.ctrl === true || key.meta === true || key.shift === true) return false;
  return input === "y" || input === "Y";
}

export type ConfirmStripKeyDecision =
  | "idle"
  | "hold"
  | "execute"
  | "cancel"
  | "cancel-and-continue";

/**
 * What an armed confirmation does with one keypress.
 * `cancel-and-continue` disarms and lets the same press move the selection.
 * A failed strip holds until Escape; arrows must not dismiss the error.
 */
export function confirmStripKeyDecision(
  kind: ConfirmStripState["kind"],
  input: string,
  key: {
    readonly ctrl?: boolean;
    readonly meta?: boolean;
    readonly shift?: boolean;
    readonly upArrow?: boolean;
    readonly downArrow?: boolean;
    readonly leftArrow?: boolean;
    readonly rightArrow?: boolean;
    readonly tab?: boolean;
  },
  options?: { readonly continueOnVerticalArrows?: boolean },
): ConfirmStripKeyDecision {
  if (kind === "idle") return "idle";
  if (kind === "executing" || kind === "failed") return "hold";
  if (isPlainConfirmKey(input, key)) return "execute";
  const vertical = key.upArrow === true || key.downArrow === true;
  if (vertical && options?.continueOnVerticalArrows === true) return "cancel-and-continue";
  if (vertical || key.leftArrow === true || key.rightArrow === true || key.tab === true) {
    return "cancel";
  }
  return "hold";
}

/** Pointer row actions wait until a destructive execute finishes. */
export function confirmStripBlocksPointer(kind: ConfirmStripState["kind"]): boolean {
  return kind === "executing";
}

/** Whether a human-readable destructive action is currently awaiting y/Esc. */
export function confirmStripArmed(state: ConfirmStripState): boolean {
  return state.kind === "armed";
}

/**
 * While armed the footer is the confirmation contract and nothing else: one
 * affirmative key, one cancel key. Mouse activation is deliberately explicit
 * through `allowMouseDestructive`; ordinary destructive footer chips remain
 * keyboard-only in ShellFooter.
 */
export function confirmStripFooterActions(state: ConfirmStripState): readonly FooterAction[] {
  if (state.kind === "armed") {
    return [
      {
        key: "y",
        label: state.verb,
        primary: true,
        narrowEssential: true,
        allowMouseDestructive: true,
      },
      { key: "esc", label: "cancel", narrowEssential: true, allowMouseDestructive: true },
    ];
  }
  if (state.kind === "failed") {
    return [{ key: "esc", label: "dismiss", narrowEssential: true }];
  }
  return [];
}
