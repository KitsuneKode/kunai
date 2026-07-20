import { expect, test } from "bun:test";

import { storageSettingsRows } from "@/app-shell/settings/registry/storage";

test("Settings Storage includes reset provider health action", () => {
  const rows = storageSettingsRows({} as never);
  expect(rows.some((row) => row.id === "resetProviderHealth")).toBe(true);
});
