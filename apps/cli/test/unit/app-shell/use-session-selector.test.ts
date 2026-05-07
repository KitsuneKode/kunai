import { describe, expect, test } from "bun:test";

import { subscribeSessionSelector } from "@/app-shell/use-session-selector";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import type { SessionState, StateTransition } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";

class TestSessionStateManager implements SessionStateManager {
  private state = createInitialState("vidking", "allanime");
  private listeners = new Set<
    (state: SessionState, transition: StateTransition, prevState: SessionState) => void
  >();

  getState(): SessionState {
    return this.state;
  }

  dispatch(transition: StateTransition): void {
    const prevState = this.state;
    this.state = reduceState(prevState, transition);
    for (const listener of this.listeners) {
      listener(this.state, transition, prevState);
    }
  }

  subscribe(
    listener: (state: SessionState, transition: StateTransition, prevState: SessionState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  initialize(defaultProvider: string, defaultAnimeProvider: string): void {
    this.state = createInitialState(defaultProvider, defaultAnimeProvider);
  }
}

describe("session selector subscriptions", () => {
  test("notifies only when the selected value changes", () => {
    const manager = new TestSessionStateManager();
    const selectedModes: string[] = [];

    const unsubscribe = subscribeSessionSelector(
      manager,
      (state) => state.mode,
      (mode) => {
        selectedModes.push(mode);
      },
    );

    manager.dispatch({ type: "SET_PROVIDER", provider: "rivestream" });
    manager.dispatch({ type: "SET_SEARCH_QUERY", query: "friends" });
    expect(selectedModes).toEqual([]);

    manager.dispatch({ type: "SET_MODE", mode: "anime", provider: "allanime" });
    expect(selectedModes).toEqual(["anime"]);

    unsubscribe();
    manager.dispatch({ type: "SET_MODE", mode: "series", provider: "vidking" });
    expect(selectedModes).toEqual(["anime"]);
  });
});
