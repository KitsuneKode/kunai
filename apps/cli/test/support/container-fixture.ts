import type { Container } from "@/container";

type OverlayRecord = { readonly type: string };

export type MockStateManager = {
  getState: () => { activeModals: OverlayRecord[] };
  dispatch: (event: { type: string; overlay?: OverlayRecord; [key: string]: unknown }) => void;
  subscribe: (listener: (state: { activeModals: OverlayRecord[] }) => void) => () => void;
};

export type ContainerFixture = {
  readonly container: Container;
  readonly dispatches: string[];
  readonly stateManager: MockStateManager;
  closeTopOverlay: () => void;
};

/** Lightweight partial Container with a reactive overlay-capable state manager. */
export function createContainerFixture(overrides: Partial<Container> = {}): ContainerFixture {
  let activeModals: OverlayRecord[] = [];
  const listeners = new Set<(state: { activeModals: OverlayRecord[] }) => void>();
  const dispatches: string[] = [];
  const notify = () => {
    for (const listener of listeners) {
      listener({ activeModals });
    }
  };

  const stateManager: MockStateManager = {
    getState: () => ({ activeModals }),
    dispatch: (event) => {
      if (event.type === "OPEN_OVERLAY" && event.overlay) {
        activeModals = [...activeModals, event.overlay];
        dispatches.push(`open:${event.overlay.type}`);
      }
      if (event.type === "REPLACE_TOP_OVERLAY" && event.overlay) {
        activeModals = [...activeModals.slice(0, -1), event.overlay];
        dispatches.push(`replace:${event.overlay.type}`);
      }
      if (event.type === "CLOSE_TOP_OVERLAY") {
        activeModals = activeModals.slice(0, -1);
        dispatches.push("close");
      }
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const container = {
    stateManager,
    ...overrides,
  } as unknown as Container;

  return {
    container,
    dispatches,
    stateManager,
    closeTopOverlay: () => stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" }),
  };
}
