import { expect, test } from "bun:test";

import { openKunaiDatabase, ProviderTitleBridgeRepository, runMigrations } from "@kunai/storage";

test("ProviderTitleBridgeRepository persists and reads native ids", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  const repo = new ProviderTitleBridgeRepository(db);

  repo.set("allanime", "anime", "20431", "bxCKTnative");
  expect(repo.get("allanime", "anime", "20431")).toBe("bxCKTnative");
});
