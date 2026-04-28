import type { ReactElement } from "react";
import { useEffect, useState } from "react";

export type RootContentKind = "browse" | "playback";

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

function notifyRootContentSubscribers() {
  for (const subscriber of rootContentSubscribers) {
    subscriber();
  }
}

export function getRootContentSession(): RootContentSession | null {
  return rootContentSession;
}

export function setRootContentSession(session: RootContentSession | null): void {
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

export function mountRootContent<TResult>({
  kind,
  renderContent,
  fallbackValue: _fallbackValue,
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

  const settle = (value: TResult) => {
    if (settled) return;
    settled = true;

    if (rootContentSession?.id === sessionId) {
      setRootContentSession(null);
    }

    resolveResult(value);
  };

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
