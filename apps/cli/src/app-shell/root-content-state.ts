import type { ReactElement } from "react";
import { useEffect, useState } from "react";

export type RootContentKind = "browse" | "loading" | "playback" | "post-playback" | "picker";

export type RootContentSession = {
  id: number;
  kind: RootContentKind;
  element: ReactElement;
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

function setRootContentSession(session: RootContentSession | null): void {
  rootContentSession = session;
  notifyRootContentSubscribers();
}

export function useRootContentSession(): RootContentSession | null {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const subscriber = () => setRevision((revision) => revision + 1);
    rootContentSubscribers.add(subscriber);
    return () => {
      rootContentSubscribers.delete(subscriber);
    };
  }, []);

  return rootContentSession;
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

export function mountRootContent<TResult>({
  kind,
  renderContent,
  fallbackValue,
}: {
  kind: RootContentKind;
  renderContent: (finish: (value: TResult) => void) => ReactElement;
  fallbackValue: TResult;
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

  setRootContentSession({
    id: sessionId,
    kind,
    element: renderContent(settle),
  });

  return {
    close: (value) => settle(value),
    result,
  };
}
