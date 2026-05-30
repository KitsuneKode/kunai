import { expect, test } from "bun:test";

import { classifyReleaseStatus } from "@/services/catalog/CatalogScheduleService";

function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const now = new Date(2026, 4, 29, 12, 0, 0); // local noon, 2026-05-29
const nowMs = now.getTime();
const today = key(now);
const yesterday = key(new Date(2026, 4, 28, 12, 0, 0));
const tomorrow = key(new Date(2026, 4, 30, 12, 0, 0));

test("date precision: an episode dated TODAY stays upcoming (no premature release)", () => {
  expect(classifyReleaseStatus(today, "date", nowMs)).toBe("upcoming");
});

test("date precision: a strictly-past date is released", () => {
  expect(classifyReleaseStatus(yesterday, "date", nowMs)).toBe("released");
});

test("date precision: a future date is upcoming", () => {
  expect(classifyReleaseStatus(tomorrow, "date", nowMs)).toBe("upcoming");
});

test("timestamp precision compares the exact instant", () => {
  expect(classifyReleaseStatus(new Date(nowMs - 1000).toISOString(), "timestamp", nowMs)).toBe(
    "released",
  );
  expect(classifyReleaseStatus(new Date(nowMs + 1000).toISOString(), "timestamp", nowMs)).toBe(
    "upcoming",
  );
});

test("null releaseAt or unknown precision is unknown", () => {
  expect(classifyReleaseStatus(null, "date", nowMs)).toBe("unknown");
  expect(classifyReleaseStatus(today, "unknown", nowMs)).toBe("unknown");
});
