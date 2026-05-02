// =============================================================================
// Shell Service Implementation
// =============================================================================

import type { SessionStateManager } from "../../domain/session/SessionStateManager";
import type { Logger } from "../logger/Logger";
import type { Tracer } from "../tracer/Tracer";
import type { ShellService, ShellState, ModalType } from "./ShellService";

export class ShellServiceImpl implements ShellService {
  private state: ShellState = { mode: "searching", query: "", results: [], selectedIndex: 0 };
  private modals: ModalType[] = [];

  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      stateManager: SessionStateManager;
    },
  ) {}

  setState(state: ShellState): void {
    this.state = state;
  }

  getState(): ShellState {
    return this.state;
  }

  setSearchQuery(query: string): void {
    if (this.state.mode === "searching") {
      this.state = { ...this.state, query };
    }
  }

  setSearchResults(results: import("../../domain/types").SearchResult[]): void {
    if (this.state.mode === "searching") {
      this.state = { ...this.state, results, selectedIndex: 0 };
    }
  }

  setSearchState(_state: "idle" | "loading" | "ready" | "error", _error?: string): void {
    // Stub
  }

  pushModal(modal: ModalType): void {
    this.modals.push(modal);
  }

  popModal(): void {
    this.modals.pop();
  }

  closeAllModals(): void {
    this.modals = [];
  }

  async waitForSelection<T>(): Promise<T | null> {
    // TODO: Implement with Ink
    return null;
  }

  async start(): Promise<void> {
    this.deps.logger.info("Shell starting");
  }

  async stop(): Promise<void> {
    this.deps.logger.info("Shell stopping");
  }
}
