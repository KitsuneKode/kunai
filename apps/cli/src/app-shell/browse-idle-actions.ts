import type { BrowseIdleContext, ShellAction } from "./types";

export function resolveIdleContinueAction(idleContext: BrowseIdleContext | undefined): ShellAction {
  return idleContext?.continueWatching?.titleId ? "resume-continue-watching" : "continue";
}
