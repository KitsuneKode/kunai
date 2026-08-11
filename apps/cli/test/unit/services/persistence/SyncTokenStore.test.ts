import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import type { KunaiPaths } from "@kunai/storage";

const created: string[] = [];

function storeIn(): { store: SyncTokenStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sync-tokens-"));
  created.push(dir);
  return { store: new SyncTokenStore({ configDir: dir } as KunaiPaths), dir };
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing token file reads as no credentials", async () => {
  const { store } = storeIn();
  expect(await store.load()).toEqual({});
});

test("a corrupt token file degrades to disconnected instead of throwing", async () => {
  const { store, dir } = storeIn();
  writeFileSync(join(dir, "sync-tokens.json"), "{ not json");

  expect(await store.load()).toEqual({});
});

test("round-trips AniList credentials including expiry", async () => {
  const { store } = storeIn();
  await store.patchAniList({
    accessToken: "token",
    userId: 7,
    username: "kitsune",
    expiresAt: "2027-01-01T00:00:00.000Z",
  });

  const loaded = await store.load();
  expect(loaded.anilist).toEqual({
    accessToken: "token",
    userId: 7,
    username: "kitsune",
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
});

test("patching one tracker leaves the other untouched", async () => {
  const { store } = storeIn();
  await store.patchAniList({ accessToken: "token", userId: 7 });
  await store.patchTmdb({ sessionId: "session", accountId: 42 });

  await store.patchAniList(undefined);

  const loaded = await store.load();
  expect(loaded.anilist).toBeUndefined();
  expect(loaded.tmdb).toMatchObject({ sessionId: "session", accountId: 42 });
});

// Older builds wrote the username into `accountId`, which the TMDB account
// endpoints reject as an id. Reading it back as a username keeps those installs
// working instead of silently 404ing every list write.
test("normalizes a legacy token file that stored the username as accountId", async () => {
  const { store, dir } = storeIn();
  writeFileSync(
    join(dir, "sync-tokens.json"),
    JSON.stringify({ tmdb: { sessionId: "session", accountId: "kitsune" } }),
  );

  const loaded = await store.load();
  expect(loaded.tmdb).toEqual({ sessionId: "session", username: "kitsune" });
});

test("coerces a numeric-string accountId back to a number", async () => {
  const { store, dir } = storeIn();
  writeFileSync(
    join(dir, "sync-tokens.json"),
    JSON.stringify({ tmdb: { sessionId: "session", accountId: "42" } }),
  );

  expect((await store.load()).tmdb).toEqual({ sessionId: "session", accountId: 42 });
});

test("drops a TMDB record with no session id", async () => {
  const { store, dir } = storeIn();
  writeFileSync(join(dir, "sync-tokens.json"), JSON.stringify({ tmdb: { accountId: 42 } }));

  expect((await store.load()).tmdb).toBeUndefined();
});
