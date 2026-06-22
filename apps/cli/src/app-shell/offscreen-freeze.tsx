import React from "react";

type OffscreenFreezeProps = {
  /** When false, children are not mounted for fresh updates. */
  readonly active: boolean;
  /** When true, return the last rendered element instead of reconciling children. */
  readonly frozen: boolean;
  readonly children: React.ReactNode;
};

/**
 * Caches the last rendered subtree when frozen so animated loaders stop
 * reconciling off-viewport (reference OffscreenFreeze pattern).
 */
export function OffscreenFreeze({ active, frozen, children }: OffscreenFreezeProps) {
  const cacheRef = React.useRef<React.ReactElement | null>(null);

  if (!active) {
    cacheRef.current = null;
    return null;
  }

  if (frozen && cacheRef.current) {
    return cacheRef.current;
  }

  const element = <>{children}</>;
  cacheRef.current = element;
  return element;
}
