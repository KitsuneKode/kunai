import React from "react";

const ShellCommandModeContext = React.createContext(false);

export function ShellCommandModeProvider({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <ShellCommandModeContext.Provider value={open}>{children}</ShellCommandModeContext.Provider>
  );
}

/** True while `/` command palette owns keyboard input. */
export function useShellCommandModeOpen(): boolean {
  return React.useContext(ShellCommandModeContext);
}
