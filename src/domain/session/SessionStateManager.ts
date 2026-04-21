// =============================================================================
// Session State Manager
//
// Centralized state management with transition logging.
// =============================================================================

import type { Logger } from "../../infra/logger/Logger";
import type { SessionState, StateTransition } from "./SessionState";
import { createInitialState, reduceState } from "./SessionState";

export interface StateListener {
  (state: SessionState, transition: StateTransition, prevState: SessionState): void;
}

export interface SessionStateManager {
  getState(): SessionState;
  dispatch(transition: StateTransition): void;
  subscribe(listener: StateListener): () => void;
  initialize(defaultProvider: string, defaultAnimeProvider: string): void;
}

export interface SessionStateManagerDeps {
  logger: Logger;
}

export class SessionStateManagerImpl implements SessionStateManager {
  private state: SessionState = createInitialState("vidking", "allanime");
  private listeners = new Set<StateListener>();
  
  constructor(private deps: SessionStateManagerDeps) {}
  
  initialize(defaultProvider: string, defaultAnimeProvider: string): void {
    this.state = createInitialState(defaultProvider, defaultAnimeProvider);
    this.deps.logger.info("Session state initialized", {
      defaultProvider,
      defaultAnimeProvider,
    });
  }
  
  getState(): SessionState {
    return this.state;
  }
  
  dispatch(transition: StateTransition): void {
    const prevState = this.state;
    this.state = reduceState(prevState, transition);
    
    // Log transition for debugging
    this.deps.logger.debug("State transition", {
      type: transition.type,
      prevMode: prevState.mode,
      nextMode: this.state.mode,
      hasTitle: !!this.state.currentTitle,
      searchResults: this.state.searchResults.length,
    });
    
    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(this.state, transition, prevState);
      } catch (e) {
        this.deps.logger.error("State listener failed", { error: String(e) });
      }
    });
  }
  
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
