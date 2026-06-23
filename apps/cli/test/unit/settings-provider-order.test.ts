import { expect, test } from "bun:test";

import {
  applySeriesProviderOrder,
  describeProviderOrder,
  moveProviderInOrder,
  resolveSeriesProviderOrder,
} from "@/app-shell/settings/provider-order";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

test("resolveSeriesProviderOrder dedupes default and priority", () => {
  const order = resolveSeriesProviderOrder({
    ...DEFAULT_CONFIG,
    provider: "vidlink",
    providerPriority: ["vidking", "vidlink", "rivestream"],
  });
  expect(order).toEqual(["vidlink", "vidking", "rivestream"]);
});

test("applySeriesProviderOrder writes default plus fallback chain", () => {
  const next = applySeriesProviderOrder(DEFAULT_CONFIG, ["rivestream", "vidking", "vidlink"]);
  expect(next.provider).toBe("rivestream");
  expect(next.providerPriority).toEqual(["vidking", "vidlink"]);
  expect(describeProviderOrder(resolveSeriesProviderOrder(next))).toBe(
    "rivestream → vidking → vidlink",
  );
});

test("moveProviderInOrder swaps neighbors and clamps at ends", () => {
  const order = ["vidking", "vidlink", "rivestream"];
  expect(moveProviderInOrder(order, "vidlink", "up")).toEqual(["vidlink", "vidking", "rivestream"]);
  expect(moveProviderInOrder(order, "vidlink", "down")).toEqual([
    "vidking",
    "rivestream",
    "vidlink",
  ]);
  expect(moveProviderInOrder(order, "vidking", "up")).toEqual(order);
  expect(moveProviderInOrder(order, "rivestream", "down")).toEqual(order);
});
