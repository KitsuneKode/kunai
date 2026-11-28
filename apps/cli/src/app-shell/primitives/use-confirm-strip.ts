import { useCallback, useMemo, useRef, useState } from "react";

import {
  idleConfirmStripState,
  transitionConfirmStrip,
  type ConfirmStripAction,
  type ConfirmStripState,
  type ConfirmStripTransition,
} from "./ConfirmStrip.model";

export type ConfirmStripController = {
  readonly state: ConfirmStripState;
  /** Apply one pure transition and return the transition (including any execute effect). */
  readonly transition: (action: ConfirmStripAction) => ConfirmStripTransition;
  readonly reset: () => void;
};

/**
 * React adapter for the pure ConfirmStrip machine. The ref is authoritative
 * for input handlers, so two keys in the same commit cannot both read a stale
 * armed state; the state value remains the render snapshot.
 */
export function useConfirmStripController(): ConfirmStripController {
  const [state, setState] = useState<ConfirmStripState>(idleConfirmStripState);
  const stateRef = useRef<ConfirmStripState>(idleConfirmStripState);
  const transition = useCallback((action: ConfirmStripAction) => {
    const next = transitionConfirmStrip(stateRef.current, action);
    stateRef.current = next.state;
    setState(next.state);
    return next;
  }, []);
  const reset = useCallback(() => {
    stateRef.current = idleConfirmStripState;
    setState(idleConfirmStripState);
  }, []);
  return useMemo(() => ({ state, transition, reset }), [state, transition, reset]);
}
