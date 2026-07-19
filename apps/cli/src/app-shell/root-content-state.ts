import { clearRootContentTransitionFrame } from "@/app-shell/shell-screen-clear";
import type { SessionState } from "@/domain/session/SessionState";
import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";

import { resolveRootShellSurface, type RootShellSurface } from "./root-shell-state";

export type RootContentKind = "browse" | "loading" | "playback" | "post-playback" | "picker";

export type RootContentSession = {
  id: number;
  kind: RootContentKind;
  element: ReactElement;
  /** Optional AppHeader pill when kind alone is too vague (e.g. picker → Stats). */
  headerLabel?: string;
};

type MountedRootContent<TResult> = {
  close: (value: TResult) => void;
  result: Promise<TResult>;
};

const rootContentSubscribers = new Set<() => void>();
let rootContentSession: RootContentSession | null = null;
let rootContentNextId = 1;

type PendingRootContentMount = {
  readonly sessionId: number;
  readonly settle: (value: unknown) => void;
  readonly fallbackValue: unknown;
};

const pendingRootContentMounts = new Set<PendingRootContentMount>();

function notifyRootContentSubscribers() {
  for (const subscriber of rootContentSubscribers) {
    subscriber();
  }
}

export function getRootContentSession(): RootContentSession | null {
  return rootContentSession;
}

export function subscribeRootContentSession(subscriber: () => void): () => void {
  rootContentSubscribers.add(subscriber);
  return () => {
    rootContentSubscribers.delete(subscriber);
  };
}

function setRootContentSession(session: RootContentSession | null): void {
  rootContentSession = session;
  notifyRootContentSubscribers();
}

export function useRootContentSession(): RootContentSession | null {
  return useSyncExternalStore(
    subscribeRootContentSession,
    getRootContentSession,
    getRootContentSession,
  );
}

export function clearRootContentSession(): void {
  setRootContentSession(null);
}

/** Resolve any blocked `mountRootContent` promises during Ink teardown. */
export function forceSettleAllRootContent(_reason: string): void {
  for (const mount of pendingRootContentMounts) {
    mount.settle(mount.fallbackValue);
  }
  pendingRootContentMounts.clear();
  setRootContentSession(null);
}

export function forceCloseRootContent<TResult>(value: TResult): boolean {
  if (!rootContentSession) return false;
  const mount = [...pendingRootContentMounts].find(
    (candidate) => candidate.sessionId === rootContentSession?.id,
  );
  if (!mount) return false;
  mount.settle(value);
  return true;
}

export type ResolvedRootContent =
  | { readonly kind: "idle" }
  | { readonly kind: "error" }
  | { readonly kind: "playback" }
  | { readonly kind: "mounted"; readonly session: RootContentSession }
  | { readonly kind: "overlay-over-mounted"; readonly session: RootContentSession }
  | { readonly kind: "overlay" };

/**
 * Kinds allowed to stay mounted (hidden, not torn down) beneath a root-owned
 * overlay. Browse and post-playback carry local UI state worth preserving;
 * picker/loading sessions are short-lived promises that are safe to keep
 * fully hidden behind a plain overlay surface instead.
 */
export function isRetainableRootContentKind(kind: RootContentKind): boolean {
  return kind === "browse" || kind === "post-playback";
}

export function resolveRootContentFromSession(
  state: SessionState,
  {
    rootContent,
    hasMountedScreen = false,
  }: {
    readonly rootContent: RootContentSession | null;
    readonly hasMountedScreen?: boolean;
  },
): ResolvedRootContent {
  const surface = resolveRootShellSurface(state, {
    hasRootContent: Boolean(rootContent),
    hasMountedScreen,
    rootContentKind: rootContent?.kind,
  });
  return resolvedRootContentFromSurface(surface, rootContent);
}

export function resolvedRootContentFromSurface(
  surface: RootShellSurface,
  rootContent: RootContentSession | null,
): ResolvedRootContent {
  switch (surface) {
    case "error":
      return { kind: "error" };
    case "playback":
      return { kind: "playback" };
    case "root-content":
      return rootContent ? { kind: "mounted", session: rootContent } : { kind: "idle" };
    case "root-overlay":
      return rootContent && isRetainableRootContentKind(rootContent.kind)
        ? { kind: "overlay-over-mounted", session: rootContent }
        : { kind: "overlay" };
    case "mounted-screen":
    case "idle":
    default:
      return { kind: "idle" };
  }
}

export function mountRootContent<TResult>({
  kind,
  renderContent,
  fallbackValue,
  headerLabel,
}: {
  kind: RootContentKind;
  renderContent: (finish: (value: TResult) => void) => ReactElement;
  fallbackValue: TResult;
  headerLabel?: string;
}): MountedRootContent<TResult> {
  const sessionId = rootContentNextId++;
  let settled = false;
  let resolveResult!: (value: TResult) => void;

  const result = new Promise<TResult>((resolve) => {
    resolveResult = resolve;
  });

  let settle!: (value: TResult) => void;
  const pendingMount: PendingRootContentMount = {
    sessionId,
    settle: (value) => settle(value as TResult),
    fallbackValue,
  };

  settle = (value: TResult) => {
    if (settled) return;
    settled = true;
    pendingRootContentMounts.delete(pendingMount);

    if (rootContentSession?.id === sessionId) {
      setRootContentSession(null);
    }

    resolveResult(value);
  };

  pendingRootContentMounts.add(pendingMount);

  if (rootContentSession !== null && rootContentSession.id !== sessionId) {
    clearRootContentTransitionFrame();
  }

  setRootContentSession({
    id: sessionId,
    kind,
    element: renderContent(settle),
    ...(headerLabel ? { headerLabel } : {}),
  });

  return {
    close: (value) => settle(value),
    result,
  };
}
