import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { useSyncExternalStore } from "react";

export type SessionSelector<T> = (state: SessionState) => T;
export type SessionSelectorEquality<T> = (left: T, right: T) => boolean;

export function subscribeSessionSelector<T>(
  stateManager: SessionStateManager,
  selector: SessionSelector<T>,
  onSelectedChange: (selected: T) => void,
  isEqual: SessionSelectorEquality<T> = Object.is,
): () => void {
  let selected = selector(stateManager.getState());

  return stateManager.subscribe((state) => {
    const nextSelected = selector(state);
    if (isEqual(selected, nextSelected)) {
      return;
    }

    selected = nextSelected;
    onSelectedChange(nextSelected);
  });
}

export function useSessionSelector<T>(
  stateManager: SessionStateManager,
  selector: SessionSelector<T>,
  isEqual?: SessionSelectorEquality<T>,
): T {
  return useSyncExternalStore(
    (onStoreChange) =>
      subscribeSessionSelector(
        stateManager,
        selector,
        () => {
          onStoreChange();
        },
        isEqual,
      ),
    () => selector(stateManager.getState()),
    () => selector(stateManager.getState()),
  );
}
