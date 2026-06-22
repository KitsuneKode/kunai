import React from "react";

import { useShellDimensions } from "./use-viewport-policy";

export type OverlayLayoutValue = {
  readonly contentRows: number;
  readonly contentColumns: number;
  readonly chromeRows: number;
  readonly listMaxVisible: number;
};

const OverlayLayoutContext = React.createContext<OverlayLayoutValue | null>(null);

export function OverlayLayoutProvider({
  value,
  children,
}: {
  readonly value: OverlayLayoutValue;
  readonly children: React.ReactNode;
}) {
  return <OverlayLayoutContext.Provider value={value}>{children}</OverlayLayoutContext.Provider>;
}

export function useOverlayLayout(): OverlayLayoutValue {
  const layout = React.useContext(OverlayLayoutContext);
  if (!layout) {
    throw new Error("useOverlayLayout must be used within OverlayLayoutProvider");
  }
  return layout;
}

export function useIsInsideOverlay(): boolean {
  return React.useContext(OverlayLayoutContext) !== null;
}

export function useOverlayOrTerminalSize(fallback?: {
  readonly rows: number;
  readonly cols: number;
}) {
  const layout = React.useContext(OverlayLayoutContext);
  const terminal = useShellDimensions();
  if (layout) {
    return { rows: layout.contentRows, cols: layout.contentColumns };
  }
  return fallback ?? terminal;
}
