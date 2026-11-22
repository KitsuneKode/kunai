import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateCachedProviderHotfixManifest,
  readProviderDefinitionsSnapshot,
  rollbackProviderDefinitionsFromShell,
  updateProviderDefinitionsFromShell,
  type ProviderDefinitionsUpdateContainer,
} from "@/app/providers/provider-definitions-actions";
import {
  getActiveProviderHotfixManifest,
  setActiveProviderHotfixManifest,
} from "@/services/providers/provider-hotfix-manifest";
import { DEFAULT_CONFIG } from "@kunai/config";
import { signProviderManifest, type ProviderHotfixManifest } from "@kunai/providers";

const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");
const tempDirs: string[] = [];

afterEach(() => {
  setActiveProviderHotfixManifest(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function makeManifest(
  revision: number,
  overrides?: Partial<ProviderHotfixManifest>,
): ProviderHotfixManifest {
  return {
    schemaVersion: 1,
    revision,
    generatedAt: "2026-11-20T00:00:00.000Z",
    expiresAt: "2026-12-20T00:00:00.000Z",
    lanePriorities: {
      series: ["movy", "vidrock"],
      anime: ["hianime", "kickassanime"],
    },
    providers: {
      vidlink: { disabled: true },
    },
    ...overrides,
  };
}

function makeFakeContainer(options: { readonly offlineMode?: boolean } = {}) {
  const priorityUpdates: Array<{
    readonly series?: readonly string[];
    readonly disabledProviderIds?: readonly string[];
  }> = [];
  const rawConfig = {
    ...DEFAULT_CONFIG,
    offlineMode: options.offlineMode ?? false,
  };
  const container: ProviderDefinitionsUpdateContainer = {
    config: { getRaw: () => rawConfig },
    engine: {
      modules: [
        { manifest: { id: "vidlink", mediaKinds: ["movie", "series"] } },
        { manifest: { id: "movy", mediaKinds: ["movie", "series"] } },
        { manifest: { id: "vidrock", mediaKinds: ["movie", "series"] } },
        { manifest: { id: "hianime", mediaKinds: ["anime"] } },
        { manifest: { id: "kickassanime", mediaKinds: ["anime"] } },
      ],
    },
    providerRegistry: {
      setPriority(input) {
        priorityUpdates.push({
          series: input.providerPriority,
          disabledProviderIds: input.disabledProviderIds,
        });
      },
    },
  };
  return { container, priorityUpdates };
}

describe("TUI provider definitions actions", () => {
  test("verifies Ed25519 updates, hot-reloads registry priority, tracks backupRevision, and rolls back cleanly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-tui-defs-"));
    tempDirs.push(dir);
    const cachePath = join(dir, "providers-manifest.json");
    const statePath = join(dir, "providers-manifest-state.json");
    const { publicPem, privatePem } = makeKeypair();
    const trustedPublicKeysById = { "key-2026": publicPem };
    const { container, priorityUpdates } = makeFakeContainer();

    expect(
      readProviderDefinitionsSnapshot({ path: cachePath, trustedPublicKeysById, nowMs: NOW_MS }),
    ).toEqual({ activeRevision: null, activeExpiresAt: null, backupRevision: null });

    const rev5 = signProviderManifest(makeManifest(5), privatePem, "key-2026");
    const first = await updateProviderDefinitionsFromShell(container, {
      manifestUrl: "https://manifests.kunai.test/providers.json",
      path: cachePath,
      statePath,
      trustedPublicKeysById,
      nowMs: NOW_MS,
      fetchImpl: async () =>
        new Response(JSON.stringify(rev5), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(first).toBe("Updated to rev 5");
    expect(getActiveProviderHotfixManifest()?.revision).toBe(5);
    expect(priorityUpdates.at(-1)?.disabledProviderIds).toContain("vidlink");

    const rev6 = signProviderManifest(
      makeManifest(6, { providers: { rivestream: { disabled: true } } }),
      privatePem,
      "key-2026",
    );
    const second = await updateProviderDefinitionsFromShell(container, {
      manifestUrl: "https://manifests.kunai.test/providers.json",
      path: cachePath,
      statePath,
      trustedPublicKeysById,
      nowMs: NOW_MS,
      fetchImpl: async () =>
        new Response(JSON.stringify(rev6), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(second).toBe("Updated to rev 6");
    expect(
      readProviderDefinitionsSnapshot({ path: cachePath, trustedPublicKeysById, nowMs: NOW_MS }),
    ).toMatchObject({ activeRevision: 6, backupRevision: 5 });

    const rolled = await rollbackProviderDefinitionsFromShell(container, {
      path: cachePath,
      statePath,
      trustedPublicKeysById,
      nowMs: NOW_MS,
    });
    expect(rolled).toBe("Rolled back to rev 5");
    expect(getActiveProviderHotfixManifest()?.revision).toBe(5);
    expect(priorityUpdates.at(-1)?.disabledProviderIds).toContain("vidlink");
  });

  test("a fresh process activates the verified cached manifest; expired, untrusted, or absent stays bundled", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-tui-defs-"));
    tempDirs.push(dir);
    const cachePath = join(dir, "providers-manifest.json");
    const { publicPem, privatePem } = makeKeypair();
    const trustedPublicKeysById = { "key-2026": publicPem };

    // Nothing cached yet.
    const empty = makeFakeContainer();
    expect(
      activateCachedProviderHotfixManifest(empty.container, {
        path: cachePath,
        trustedPublicKeysById,
        nowMs: NOW_MS,
      }),
    ).toBe("absent");
    expect(empty.priorityUpdates).toHaveLength(0);

    // An earlier run cached rev 7; this process starts with nothing active.
    writeFileSync(
      cachePath,
      JSON.stringify(signProviderManifest(makeManifest(7), privatePem, "key-2026")),
    );
    setActiveProviderHotfixManifest(null);
    const { container, priorityUpdates } = makeFakeContainer();
    expect(
      activateCachedProviderHotfixManifest(container, {
        path: cachePath,
        trustedPublicKeysById,
        nowMs: NOW_MS,
      }),
    ).toBe("active");
    expect(getActiveProviderHotfixManifest(NOW_MS)?.revision).toBe(7);
    expect(priorityUpdates.at(-1)?.disabledProviderIds).toContain("vidlink");

    // Past expiresAt: not activated.
    setActiveProviderHotfixManifest(null);
    const expired = makeFakeContainer();
    expect(
      activateCachedProviderHotfixManifest(expired.container, {
        path: cachePath,
        trustedPublicKeysById,
        nowMs: Date.parse("2026-12-21T00:00:00.000Z"),
      }),
    ).toBe("invalid");
    expect(getActiveProviderHotfixManifest(NOW_MS)).toBeNull();
    expect(expired.priorityUpdates).toHaveLength(0);

    // A damaged oversized cache is refused from its size, not parsed.
    const oversizedPath = join(dir, "oversized.json");
    writeFileSync(oversizedPath, " ".repeat(300 * 1024));
    const oversized = makeFakeContainer();
    expect(
      activateCachedProviderHotfixManifest(oversized.container, {
        path: oversizedPath,
        trustedPublicKeysById,
        nowMs: NOW_MS,
      }),
    ).toBe("invalid");
    expect(oversized.priorityUpdates).toHaveLength(0);

    // Signed by a key this install does not trust: not activated.
    const other = makeKeypair();
    const untrusted = makeFakeContainer();
    expect(
      activateCachedProviderHotfixManifest(untrusted.container, {
        path: cachePath,
        trustedPublicKeysById: { "key-2026": other.publicPem },
        nowMs: NOW_MS,
      }),
    ).toBe("invalid");
    expect(getActiveProviderHotfixManifest(NOW_MS)).toBeNull();
  });

  test("the registry drops manifest disables when the manifest expires mid-session", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-tui-defs-"));
    tempDirs.push(dir);
    const cachePath = join(dir, "providers-manifest.json");
    const { publicPem, privatePem } = makeKeypair();
    writeFileSync(
      cachePath,
      JSON.stringify(signProviderManifest(makeManifest(9), privatePem, "key-2026")),
    );
    const { container, priorityUpdates } = makeFakeContainer();
    let clock = NOW_MS;
    const armed: Array<{ readonly task: () => void; readonly delayMs: number }> = [];

    expect(
      activateCachedProviderHotfixManifest(container, {
        path: cachePath,
        trustedPublicKeysById: { "key-2026": publicPem },
        nowMs: NOW_MS,
        clock: () => clock,
        schedule: (task, delayMs) => {
          armed.push({ task, delayMs });
          return () => undefined;
        },
      }),
    ).toBe("active");
    expect(priorityUpdates.at(-1)?.disabledProviderIds).toContain("vidlink");
    // expiresAt (2026-12-20) is 28 days out, past setTimeout's ~24.8-day
    // ceiling: the first timer is clamped and re-arms for the remainder.
    const expiresAtMs = Date.parse("2026-12-20T00:00:00.000Z");
    expect(armed).toHaveLength(1);
    expect(armed[0]?.delayMs).toBe(2_147_483_647);

    clock = NOW_MS + 2_147_483_647;
    armed[0]?.task();
    expect(priorityUpdates.at(-1)?.disabledProviderIds).toContain("vidlink");
    expect(armed).toHaveLength(2);
    expect(armed[1]?.delayMs).toBe(expiresAtMs - clock + 1_000);

    clock = expiresAtMs + 1_000;
    armed[1]?.task();
    expect(getActiveProviderHotfixManifest(clock)).toBeNull();
    expect(priorityUpdates.at(-1)?.disabledProviderIds).not.toContain("vidlink");
    // Nothing left to expire, so nothing re-arms.
    expect(armed).toHaveLength(2);
  });

  test("refuses remote fetches when offline mode is enabled", async () => {
    const { container } = makeFakeContainer({ offlineMode: true });
    const msg = await updateProviderDefinitionsFromShell(container, {
      manifestUrl: "https://manifests.kunai.test/providers.json",
    });
    expect(msg).toContain("offline");
  });
});
