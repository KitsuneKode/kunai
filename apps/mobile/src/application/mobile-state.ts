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

export function decodeMobileState<T>(value: T): MobileState {
  if (value === undefined) return createDefaultMobileState();
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Invalid mobile state");
  }

  const allowedKeys = new Set(["schemaVersion", "hostProofRuns", "lastResult"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Invalid mobile state");
  }

  // SAFETY: value is Kunai's own persisted state JSON; every field is
  // validated below before it lands in the returned object, so the typed
  // view only unlocks keyed access.
  const record = value as Partial<MobileState>;
  const hostProofRuns = record.hostProofRuns;
  if (
    record.schemaVersion !== 1 ||
    hostProofRuns === undefined ||
    !Number.isInteger(hostProofRuns) ||
    hostProofRuns < 0 ||
    (record.lastResult !== undefined && !LAST_RESULTS.has(record.lastResult))
  ) {
    throw new Error("Invalid mobile state");
  }

  return {
    schemaVersion: 1,
    hostProofRuns,
    ...(record.lastResult !== undefined && { lastResult: record.lastResult }),
  };
}
