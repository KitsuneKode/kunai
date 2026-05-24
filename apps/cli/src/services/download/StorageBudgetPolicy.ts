export const DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES = 768 * 1024 * 1024;
export const DEFAULT_OFFLINE_RUNWAY_TARGET = 2;

export type StorageAdmission =
  | {
      readonly allowed: true;
      readonly estimatedBytes: number;
      readonly remainingBytesAfterReserve: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "below-reserve" | "unknown-size-too-tight";
      readonly requiredBytes: number;
    };

export function estimateAllowedNewAssets(input: {
  readonly availableBytes: number;
  readonly reserveBytes: number;
  readonly unknownEpisodeEstimateBytes: number;
  readonly alreadyReservedBytes?: number;
  readonly maxAssets?: number;
}): number {
  const availableBytes = nonNegativeBytes(input.availableBytes);
  const reserveBytes = nonNegativeBytes(input.reserveBytes);
  const estimate = nonNegativeBytes(input.unknownEpisodeEstimateBytes);
  const alreadyReservedBytes = nonNegativeBytes(input.alreadyReservedBytes ?? 0);
  if (estimate === 0) return input.maxAssets ?? 0;
  const remaining = availableBytes - reserveBytes - alreadyReservedBytes;
  if (remaining < estimate) return 0;
  return Math.max(0, Math.min(input.maxAssets ?? 100, Math.floor(remaining / estimate)));
}

export function evaluateStorageAdmission(input: {
  readonly availableBytes: number;
  readonly estimatedBytes?: number;
  readonly reserveBytes: number;
  readonly unknownEpisodeEstimateBytes: number;
  readonly alreadyReservedBytes?: number;
}): StorageAdmission {
  const availableBytes = nonNegativeBytes(input.availableBytes);
  const reserveBytes = nonNegativeBytes(input.reserveBytes);
  const estimate =
    typeof input.estimatedBytes === "number"
      ? nonNegativeBytes(input.estimatedBytes)
      : nonNegativeBytes(input.unknownEpisodeEstimateBytes);
  const alreadyReservedBytes = nonNegativeBytes(input.alreadyReservedBytes ?? 0);
  const remainingAfterReserve = availableBytes - reserveBytes - alreadyReservedBytes;
  if (remainingAfterReserve < 0) {
    return { allowed: false, reason: "below-reserve", requiredBytes: reserveBytes };
  }
  if (remainingAfterReserve < estimate) {
    return {
      allowed: false,
      reason: "unknown-size-too-tight",
      requiredBytes: reserveBytes + estimate,
    };
  }
  return {
    allowed: true,
    estimatedBytes: estimate,
    remainingBytesAfterReserve: remainingAfterReserve - estimate,
  };
}

function nonNegativeBytes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
