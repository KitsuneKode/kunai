import React, { createContext, useContext } from "react";

/**
 * Context flag for a root-content session (browse / post-playback) that is
 * mounted but currently covered by a root-owned overlay. Consumers read this
 * instead of unmounting so local UI state (selection, typed query, focus
 * zone, calendar cursor, …) survives the overlay's open/close cycle. Every
 * `useInput` hook inside a retained session must check this flag and bail —
 * Ink delivers keystrokes to every mounted hook regardless of `display`.
 */
const RootContentSuspendedContext = createContext(false);

export function RootContentSuspension({
  suspended,
  children,
}: {
  readonly suspended: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <RootContentSuspendedContext.Provider value={suspended}>
      {children}
    </RootContentSuspendedContext.Provider>
  );
}

export function useRootContentSuspended(): boolean {
  return useContext(RootContentSuspendedContext);
}
