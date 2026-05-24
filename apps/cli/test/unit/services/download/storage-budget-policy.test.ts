import { expect, test } from "bun:test";

import { evaluateStorageAdmission } from "@/services/download/StorageBudgetPolicy";

test("storage budget admits an unknown episode only when reserve and estimate remain available", () => {
  expect(
    evaluateStorageAdmission({
      availableBytes: 5_000,
      reserveBytes: 1_000,
      unknownEpisodeEstimateBytes: 2_000,
    }),
  ).toEqual({
    allowed: true,
    estimatedBytes: 2_000,
    remainingBytesAfterReserve: 2_000,
  });
});

test("storage budget rejects a volume below its protected reserve", () => {
  expect(
    evaluateStorageAdmission({
      availableBytes: 999,
      reserveBytes: 1_000,
      unknownEpisodeEstimateBytes: 10,
    }),
  ).toEqual({ allowed: false, reason: "below-reserve", requiredBytes: 1_000 });
});

test("storage budget rejects unknown work that would consume protected remaining space", () => {
  expect(
    evaluateStorageAdmission({
      availableBytes: 2_500,
      reserveBytes: 1_000,
      unknownEpisodeEstimateBytes: 2_000,
    }),
  ).toEqual({ allowed: false, reason: "unknown-size-too-tight", requiredBytes: 3_000 });
});
