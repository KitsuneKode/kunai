import React, { createContext, useContext } from "react";

/**
 * When a root-owned overlay covers a mounted browse/post-play session, the
 * session stays in the React tree (to preserve local UI state) but must not
 * consume keystrokes. Consumers gate `useInput` / `useShellInput` on this flag.
 */
const RootContentInputSuspendedContext = createContext(false);

export function RootContentInputGate({
  suspended,
  children,
}: {
  readonly suspended: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <RootContentInputSuspendedContext.Provider value={suspended}>
      {children}
    </RootContentInputSuspendedContext.Provider>
  );
}

export function useRootContentInputSuspended(): boolean {
  return useContext(RootContentInputSuspendedContext);
}
