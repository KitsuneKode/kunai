import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDismissTimerRegistry,
  type DismissTimerOperations,
  type DismissTimerRegistry,
} from "../dismiss-timer-registry";

/**
 * How long an armed destructive key stays live before the prompt disarms
 * itself. Long enough to read the affordance, short enough that a stray
 * repeat minutes later does not silently fire.
 */
export const PRESS_AGAIN_WINDOW_MS = 4_000;

export type PressAgainConfirm = {
  /** Token of the armed action, or null while nothing is pending. */
  readonly armedToken: string | null;
  /**
   * Second matching press inside the window returns true and disarms. A
   * different token re-arms under that token (the prompt now points at the new
   * target). Callers own the "any other key cancels" fallthrough via `disarm`.
   */
  readonly confirm: (token: string) => boolean;
  readonly disarm: () => void;
};

/**
 * Shared "press again to confirm" state for destructive bare-letter keys —
 * the library/download ask-once idiom, unified behind an explicit token and a
 * real expiry window. `timers` is the injected clock seam so tests can fire
 * the expiry synchronously instead of sleeping.
 */
export function usePressAgainConfirm(timers?: DismissTimerOperations): PressAgainConfirm {
  const [armedToken, setArmedToken] = useState<string | null>(null);
  const registryRef = useRef<DismissTimerRegistry | null>(null);
  registryRef.current ??= createDismissTimerRegistry(timers);

  useEffect(
    () => () => {
      registryRef.current?.dispose();
      registryRef.current = null;
    },
    [],
  );

  const confirm = useCallback(
    (token: string) => {
      if (armedToken === token) {
        // Confirmed — drop the pending expiry so a later re-arm under the same
        // token gets its own full window.
        registryRef.current?.dispose();
        setArmedToken(null);
        return true;
      }
      setArmedToken(token);
      // Token-scoped expiry: re-arming under a different token must not let a
      // stale timer disarm the newer prompt.
      registryRef.current?.schedule(() => {
        setArmedToken((armed) => (armed === token ? null : armed));
      }, PRESS_AGAIN_WINDOW_MS);
      return false;
    },
    [armedToken],
  );

  const disarm = useCallback(() => {
    // Cancel the pending expiry too: otherwise a re-arm of the same token
    // inside the original window would die when the stale timer fires.
    registryRef.current?.dispose();
    setArmedToken(null);
  }, []);

  return { armedToken, confirm, disarm };
}
