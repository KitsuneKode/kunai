import { expect, test } from "bun:test";

import { generalSettingsRows } from "@/app-shell/settings/registry/general";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function baseConfig(): KitsuneConfig {
  return {
    defaultMode: "series",
  } as KitsuneConfig;
}

test("defaultMode write preserves youtube startup mode", () => {
  const row = generalSettingsRows({} as never).find((entry) => entry.id === "defaultMode");
  expect(row?.kind).toBe("enum");

  if (row?.kind !== "enum") {
    throw new Error("expected defaultMode enum row");
  }

  const next = row.write(baseConfig(), "youtube");
  expect(next.defaultMode).toBe("youtube");
});
