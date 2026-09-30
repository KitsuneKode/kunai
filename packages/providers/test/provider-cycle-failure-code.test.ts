import { expect, test } from "bun:test";

import { providerFailureCodeFromCycleFailure } from "../src/shared/provider-cycle";

test("a rate-limited cycle failure stays rate-limited instead of collapsing to unknown", () => {
  expect(providerFailureCodeFromCycleFailure("candidate-rate-limited")).toBe("rate-limited");
  expect(providerFailureCodeFromCycleFailure("candidate-server-error")).toBe(
    "provider-unavailable",
  );
});
