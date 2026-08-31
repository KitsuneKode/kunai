import type { MobileState } from "./contracts";

const LAST_RESULTS = new Set<NonNullable<MobileState["lastResult"]>>([
  "cancelled",
  "http-ok",
  "handoff-accepted",
  "failed",
]);

export function createDefaultMobileState(): MobileState {
  return { schemaVersion: 1, hostProofRuns: 0 };
}

export function decodeMobileState(value: unknown): MobileState {
  if (value === undefined) return createDefaultMobileState();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid mobile state");
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["schemaVersion", "hostProofRuns", "lastResult"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new Error("Invalid mobile state");
  }
  if (
    record.schemaVersion !== 1 ||
    !Number.isInteger(record.hostProofRuns) ||
    (record.hostProofRuns as number) < 0 ||
    (record.lastResult !== undefined &&
      (typeof record.lastResult !== "string" ||
        !LAST_RESULTS.has(record.lastResult as NonNullable<MobileState["lastResult"]>)))
  ) {
    throw new Error("Invalid mobile state");
  }

  return {
    schemaVersion: 1,
    hostProofRuns: record.hostProofRuns as number,
    ...(record.lastResult === undefined
      ? {}
      : { lastResult: record.lastResult as NonNullable<MobileState["lastResult"]> }),
  };
}
