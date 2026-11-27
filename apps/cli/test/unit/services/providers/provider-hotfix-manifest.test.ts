import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyHotfixToProviderBootstrap,
  fetchAndCacheProviderHotfixManifest,
  loadCachedProviderHotfixManifest,
  MAX_MANIFEST_BYTES,
  maybeBackgroundRefreshProviderManifest,
  maybeUrgentProviderManifestRefresh,
  resetUrgentProviderManifestRefreshForTest,
  providerManifestBackupPath,
  providerManifestCachePath,
  providerManifestStatePath,
  resetCachedProviderHotfixManifest,
  rollbackCachedProviderHotfixManifest,
  type ManifestFetch,
} from "@/services/providers/provider-hotfix-manifest";
import { defaultManifestUrl } from "@/services/providers/provider-manifest-pin";
import { runProvidersCommand } from "@/services/providers/run-providers-command";
import {
  getActiveProviderHotfixManifest,
  setActiveProviderHotfixManifest,
  signProviderManifest,
  type ProviderHotfixManifest,
  type SignedProviderManifestEnvelope,
} from "@kunai/providers";
import type { JsonValue } from "@kunai/types";

const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");
const tempDirs: string[] = [];

afterEach(() => {
  setActiveProviderHotfixManifest(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-cache-"));
  tempDirs.push(dir);
  return join(dir, "providers-manifest.json");
}

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function makeManifest(overrides?: Partial<ProviderHotfixManifest>): ProviderHotfixManifest {
  return {
    schemaVersion: 1,
    revision: 4,
    generatedAt: "2026-11-20T00:00:00.000Z",
    expiresAt: "2026-12-20T00:00:00.000Z",
    lanePriorities: {
      series: ["movy", "vidrock"],
      anime: ["hianime", "kickassanime"],
    },
    providers: {
      vidlink: { disabled: true },
      rivestream: { mirrors: ["https://mirror.rivestream.test"] },
    },
    ...overrides,
  };
}

function jsonFetch(
  payload: JsonValue | SignedProviderManifestEnvelope,
  status = 200,
): ManifestFetch {
  return async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("provider hotfix manifest runtime", () => {
  test("rejects non-HTTPS, credentialed, and private/loopback URLs without making network calls", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem } = makeKeypair();
    let fetchCalls = 0;
    const spyFetch: ManifestFetch = async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    };

    for (const badUrl of [
      "http://manifests.kunai.test/providers.json",
      "file:///etc/passwd",
      "https://user:pass@manifests.kunai.test/providers.json",
      "https://127.0.0.1/providers.json",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/providers.json",
      "https://localhost/providers.json",
      "https://localhost./providers.json",
      "https://foo.localhost./providers.json",
      "https://127.0.0.1./providers.json",
    ]) {
      const result = await fetchAndCacheProviderHotfixManifest({
        url: badUrl,
        trustedPublicKeysById: { "key-2026": publicPem },
        path: cachePath,
        nowMs: NOW_MS,
        fetchImpl: spyFetch,
      });
      expect(result.status).toBe("rejected");
    }
    expect(fetchCalls).toBe(0);
  });

  test("follows a release download's redirect to its CDN, but only to safe HTTPS targets", async () => {
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };
    const signed = signProviderManifest(makeManifest({ revision: 4 }), privatePem, "key-2026");
    const releaseUrl = "https://github.com/owner/repo/releases/download/provider-manifest/m.json";
    const redirectTo =
      (location: string): ManifestFetch =>
      async (input, init) => {
        expect(init?.redirect).toBe("manual");
        return input === releaseUrl
          ? new Response(null, { status: 302, headers: { location } })
          : new Response(JSON.stringify(signed), { status: 200 });
      };

    const followed = await fetchAndCacheProviderHotfixManifest({
      url: releaseUrl,
      trustedPublicKeysById: keys,
      path: makeTempCachePath(),
      nowMs: NOW_MS,
      fetchImpl: redirectTo("https://release-assets.githubusercontent.com/asset?sig=x"),
    });
    expect(followed.status).toBe("updated");

    for (const unsafe of ["http://release-assets.githubusercontent.com/a", "https://127.0.0.1/a"]) {
      const refused = await fetchAndCacheProviderHotfixManifest({
        url: releaseUrl,
        trustedPublicKeysById: keys,
        path: makeTempCachePath(),
        nowMs: NOW_MS,
        fetchImpl: redirectTo(unsafe),
      });
      expect(refused).toMatchObject({ status: "rejected" });
    }

    const loop = await fetchAndCacheProviderHotfixManifest({
      url: releaseUrl,
      trustedPublicKeysById: keys,
      path: makeTempCachePath(),
      nowMs: NOW_MS,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: releaseUrl } }),
    });
    expect(loop).toMatchObject({ status: "rejected" });
  });

  test("rejects oversized responses before JSON parsing", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem } = makeKeypair();
    const hugeBody = "x".repeat(2048);

    const result = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: { "key-2026": publicPem },
      path: cachePath,
      nowMs: NOW_MS,
      maxBytes: 512,
      fetchImpl: async () => new Response(hugeBody, { status: 200 }),
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("maximum size");
    }
  });

  test("enforces anti-downgrade, idempotent unchanged, backup on upgrade, rollback, and reset", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };

    const rev4 = signProviderManifest(makeManifest({ revision: 4 }), privatePem, "key-2026");
    const dryRun = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      dryRun: true,
      fetchImpl: jsonFetch(rev4),
    });
    expect(dryRun.status).toBe("dry-run");
    expect(existsSync(cachePath)).toBe(false);

    const first = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev4),
    });
    expect(first.status).toBe("updated");
    if (first.status === "updated") expect(first.backedUp).toBe(false);

    const same = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev4),
    });
    expect(same.status).toBe("unchanged");

    const rev3 = signProviderManifest(makeManifest({ revision: 3 }), privatePem, "key-2026");
    const downgrade = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev3),
    });
    expect(downgrade.status).toBe("rejected");
    if (downgrade.status === "rejected") {
      expect(downgrade.reason).toContain("downgrade");
    }

    const rev5 = signProviderManifest(makeManifest({ revision: 5 }), privatePem, "key-2026");
    const upgrade = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev5),
    });
    expect(upgrade.status).toBe("updated");
    if (upgrade.status === "updated") {
      expect(upgrade.backedUp).toBe(true);
      expect(upgrade.previousRevision).toBe(4);
    }
    expect(existsSync(providerManifestBackupPath(cachePath))).toBe(true);

    const rolled = await rollbackCachedProviderHotfixManifest({
      path: cachePath,
      trustedPublicKeysById: keys,
      nowMs: NOW_MS,
    });
    expect(rolled.ok).toBe(true);
    if (rolled.ok) expect(rolled.manifest.revision).toBe(4);

    const loadedAfterRollback = loadCachedProviderHotfixManifest({
      path: cachePath,
      trustedPublicKeysById: keys,
      nowMs: NOW_MS,
    });
    expect(loadedAfterRollback.status).toBe("active");
    if (loadedAfterRollback.status === "active") {
      expect(loadedAfterRollback.manifest.revision).toBe(4);
    }

    const reset = await resetCachedProviderHotfixManifest({ path: cachePath, includeBackup: true });
    expect(reset.removed).toBe(true);
    expect(
      loadCachedProviderHotfixManifest({ path: cachePath, trustedPublicKeysById: keys }).status,
    ).toBe("absent");
  });

  test("rejects a manifest that would disable every provider in a lane", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const brickAllAnime = signProviderManifest(
      makeManifest({
        providers: {
          hianime: { disabled: true },
          kickassanime: { disabled: true },
        },
      }),
      privatePem,
      "key-2026",
    );

    const result = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: { "key-2026": publicPem },
      path: cachePath,
      nowMs: NOW_MS,
      knownProvidersByLane: { anime: ["hianime", "kickassanime"] },
      fetchImpl: jsonFetch(brickAllAnime),
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("disable every provider");
    }
  });

  test("fails closed on rollback when backup has been tampered with", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem } = makeKeypair();
    writeFileSync(providerManifestBackupPath(cachePath), '{"tampered":true}', "utf8");

    const rolled = await rollbackCachedProviderHotfixManifest({
      path: cachePath,
      trustedPublicKeysById: { "key-2026": publicPem },
      nowMs: NOW_MS,
    });
    expect(rolled.ok).toBe(false);
  });

  test("applyHotfixToProviderBootstrap merges disabled providers and respects explicit user order", () => {
    const manifest = makeManifest();
    const appliedDefault = applyHotfixToProviderBootstrap(
      { providerPriority: [], animeProviderPriority: [] },
      ["animegg"],
      manifest,
    );
    expect(appliedDefault.priority.providerPriority).toEqual(["movy", "vidrock"]);
    expect(appliedDefault.priority.animeProviderPriority).toEqual(["hianime", "kickassanime"]);
    expect(appliedDefault.disabledProviderIds).toEqual(["animegg", "vidlink"]);

    const appliedUserOrder = applyHotfixToProviderBootstrap(
      { providerPriority: ["vidrock", "movy"], animeProviderPriority: [] },
      [],
      manifest,
    );
    expect(appliedUserOrder.priority.providerPriority).toEqual(["vidrock", "movy"]);

    const appliedDisabledLead = applyHotfixToProviderBootstrap(
      { providerPriority: ["vidlink", "rivestream"], animeProviderPriority: [] },
      [],
      manifest,
    );
    expect(appliedDisabledLead.priority.providerPriority).toEqual([
      "movy",
      "vidrock",
      "vidlink",
      "rivestream",
    ]);
  });

  test("runProvidersCommand handles status, update, rollback, reset, and rejects unknown subcommands", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };

    let statusOut = "";
    const statusCode = await runProvidersCommand({
      subcommand: "status",
      json: true,
      cachePath,
      write: (chunk) => {
        statusOut += chunk;
      },
    });
    expect(statusCode).toBe(0);
    expect(JSON.parse(statusOut).hotfixManifest.status).toBe("absent");

    // Without --url, update asks the same channel the background refresh uses.
    // The developer's shell must not redirect or unpin it for this test.
    const savedEnv = {
      url: process.env.KUNAI_PROVIDER_MANIFEST_URL,
      keys: process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS,
    };
    delete process.env.KUNAI_PROVIDER_MANIFEST_URL;
    delete process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS;
    try {
      const requested: string[] = [];
      let defaultUrlOut = "";
      const defaultUrlCode = await runProvidersCommand({
        subcommand: "update",
        json: true,
        cachePath,
        fetchImpl: async (input) => {
          requested.push(input);
          return new Response("missing", { status: 404 });
        },
        write: (chunk) => {
          defaultUrlOut += chunk;
        },
      });
      expect(requested).toEqual([defaultManifestUrl() ?? ""]);
      expect(defaultUrlCode).not.toBe(0);
      expect(JSON.parse(defaultUrlOut).ok).toBe(false);
    } finally {
      if (savedEnv.url === undefined) delete process.env.KUNAI_PROVIDER_MANIFEST_URL;
      else process.env.KUNAI_PROVIDER_MANIFEST_URL = savedEnv.url;
      if (savedEnv.keys === undefined) delete process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS;
      else process.env.KUNAI_PROVIDER_MANIFEST_PUBKEYS = savedEnv.keys;
    }

    const rev4 = signProviderManifest(makeManifest({ revision: 4 }), privatePem, "key-2026");
    let updateOut = "";
    const updateCode = await runProvidersCommand({
      subcommand: "update",
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      cachePath,
      nowMs: NOW_MS,
      json: true,
      fetchImpl: jsonFetch(rev4),
      write: (chunk) => {
        updateOut += chunk;
      },
    });
    expect(updateCode).toBe(0);
    expect(JSON.parse(updateOut)).toMatchObject({ ok: true, status: "updated", revision: 4 });

    let resetOut = "";
    const resetCode = await runProvidersCommand({
      subcommand: "reset",
      json: true,
      cachePath,
      write: (chunk) => {
        resetOut += chunk;
      },
    });
    expect(resetCode).toBe(0);
    expect(JSON.parse(resetOut)).toMatchObject({ ok: true, removed: true });

    let badSubOut = "";
    const badSubCode = await runProvidersCommand({
      subcommand: "bogus",
      json: true,
      cachePath,
      write: (chunk) => {
        badSubOut += chunk;
      },
    });
    expect(badSubCode).toBe(2);
    expect(JSON.parse(badSubOut).ok).toBe(false);
  });

  test("maybeBackgroundRefreshProviderManifest skips when fresh/unconfigured and activates when refreshed", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };

    // No channel (an empty URL) skips without touching network.
    expect(await maybeBackgroundRefreshProviderManifest({ path: cachePath, url: "" })).toBe(
      "skipped",
    );

    // The project channel is pinned, so by default it is asked; a missing
    // manifest (404) leaves the bundled defaults in place.
    const asked: string[] = [];
    const absent = await maybeBackgroundRefreshProviderManifest({
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: async (input) => {
        asked.push(String(input));
        return new Response("", { status: 404 });
      },
    });
    expect(asked).toEqual([
      "https://github.com/KitsuneKode/kunai/releases/download/provider-manifest/provider-manifest.json",
    ]);
    expect(absent).not.toBe("updated");
    expect(getActiveProviderHotfixManifest(NOW_MS)).toBeNull();

    const rev4 = signProviderManifest(makeManifest({ revision: 4 }), privatePem, "key-2026");
    const first = await maybeBackgroundRefreshProviderManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev4),
    });
    expect(first).toBe("updated");
    expect(getActiveProviderHotfixManifest(NOW_MS)?.revision).toBe(4);

    // Fresh cached file skips within minIntervalMs.
    let calls = 0;
    const skipped = await maybeBackgroundRefreshProviderManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: Date.now() + 1_000,
      minIntervalMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(skipped).toBe("skipped");
    expect(calls).toBe(0);
  });

  test("anti-rollback revision floor survives cache-file deletion and resets only on force reset", async () => {
    const cachePath = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };

    const rev5 = signProviderManifest(makeManifest({ revision: 5 }), privatePem, "key-2026");
    const installed = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev5),
    });
    expect(installed.status).toBe("updated");

    // Simulate OS cacheDir purge (deleting the cached manifest without --force state reset).
    rmSync(cachePath, { force: true });
    expect(existsSync(cachePath)).toBe(false);

    const rev4 = signProviderManifest(makeManifest({ revision: 4 }), privatePem, "key-2026");
    const downgradeAfterPurge = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev4),
    });
    expect(downgradeAfterPurge.status).toBe("rejected");
    if (downgradeAfterPurge.status === "rejected") {
      expect(downgradeAfterPurge.reason).toContain("downgrade");
    }

    // Explicit force reset clears the floor.
    await resetCachedProviderHotfixManifest({ path: cachePath, includeBackup: true });
    const afterForceReset = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev4),
    });
    expect(afterForceReset.status).toBe("updated");
  });

  test("runProvidersCommand verify reports manifest state and AllManga crypto freshness", async () => {
    const cachePath = makeTempCachePath();
    let freshOut = "";
    const freshCode = await runProvidersCommand({
      subcommand: "verify",
      json: true,
      cachePath,
      nowMs: NOW_MS,
      write: (chunk) => {
        freshOut += chunk;
      },
    });
    expect(freshCode).toBe(0);
    const freshParsed = JSON.parse(freshOut);
    expect(freshParsed.ok).toBe(true);
    expect(freshParsed.allmangaCrypto.fresh).toBe(true);

    // Invalid cached manifest fails verify with exit code 1.
    writeFileSync(cachePath, "{invalid-json", "utf8");
    let badOut = "";
    const badCode = await runProvidersCommand({
      subcommand: "verify",
      json: true,
      cachePath,
      trustedPublicKeysById: { "key-2026": makeKeypair().publicPem },
      nowMs: NOW_MS,
      write: (chunk) => {
        badOut += chunk;
      },
    });
    expect(badCode).toBe(1);
    expect(JSON.parse(badOut).ok).toBe(false);

    // Default cache path maps its anti-rollback floor into configDir (not cacheDir).
    expect(providerManifestStatePath(providerManifestCachePath())).toBe(
      providerManifestStatePath(),
    );
    expect(providerManifestStatePath(cachePath)).toBe(cachePath.replace(/\.json$/, ".state.json"));

    // Active cached manifest with AllManga crypto rotation is reflected in verify's effectiveBuildId.
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };
    const rotated = signProviderManifest(
      makeManifest({
        revision: 9,
        providers: {
          allanime: {
            cryptoOverrides: {
              buildId: "205",
              saltMul: "17",
              saltAdd: "23",
              fragMul: "11",
              fragAdd: "3",
              bootPrefix: "PRE:",
              bootJoin: "|",
              bootParts: "group,host,lane,buildId,epoch",
              maskFragments: "AAAAAAAAAAA=,BBBBBBBBBBB=,CCCCCCCCCCC=,DDDDDDDDDDD=",
              epochMs: "604800000",
              epochGraceMs: "86400000",
            },
          },
        },
      }),
      privatePem,
      "key-2026",
    );
    writeFileSync(cachePath, JSON.stringify(rotated), "utf8");
    let hotfixVerifyOut = "";
    const hotfixVerifyCode = await runProvidersCommand({
      subcommand: "verify",
      json: true,
      cachePath,
      trustedPublicKeysById: keys,
      nowMs: NOW_MS,
      write: (chunk) => {
        hotfixVerifyOut += chunk;
      },
    });
    expect(hotfixVerifyCode).toBe(0);
    expect(JSON.parse(hotfixVerifyOut).allmangaCrypto.effectiveBuildId).toBe("205");
  });

  test("concurrent rev 2 and rev 1 updates never regress the cache or revision floor, and same-revision payload conflicts are rejected", async () => {
    const { publicPem, privatePem } = makeKeypair();
    const keys = { "key-2026": publicPem };
    const rev1 = signProviderManifest(makeManifest({ revision: 1 }), privatePem, "key-2026");
    const rev2 = signProviderManifest(makeManifest({ revision: 2 }), privatePem, "key-2026");

    for (let round = 0; round < 10; round += 1) {
      const cachePath = makeTempCachePath();
      const [a, b] = await Promise.all([
        fetchAndCacheProviderHotfixManifest({
          url: "https://manifests.kunai.test/providers.json",
          trustedPublicKeysById: keys,
          path: cachePath,
          nowMs: NOW_MS,
          fetchImpl: jsonFetch(rev2),
        }),
        fetchAndCacheProviderHotfixManifest({
          url: "https://manifests.kunai.test/providers.json",
          trustedPublicKeysById: keys,
          path: cachePath,
          nowMs: NOW_MS,
          fetchImpl: jsonFetch(rev1),
        }),
      ]);
      expect([a.status, b.status]).toContain("updated");
      const loaded = loadCachedProviderHotfixManifest({
        path: cachePath,
        trustedPublicKeysById: keys,
        nowMs: NOW_MS,
      });
      expect(loaded.status).toBe("active");
      if (loaded.status === "active") {
        expect(loaded.manifest.revision).toBe(2);
      }
    }

    // Conflicting payload claiming the already-installed revision must be rejected.
    const cachePath = makeTempCachePath();
    await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev2),
    });
    const rev2Different = signProviderManifest(
      makeManifest({ revision: 2, providers: { movy: { disabled: true } } }),
      privatePem,
      "key-2026",
    );
    const conflict = await fetchAndCacheProviderHotfixManifest({
      url: "https://manifests.kunai.test/providers.json",
      trustedPublicKeysById: keys,
      path: cachePath,
      nowMs: NOW_MS,
      fetchImpl: jsonFetch(rev2Different),
    });
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") {
      expect(conflict.reason).toContain("Conflicting manifest payload");
    }
  });
});

describe("provider hotfix manifest: reset, rollback, and body pinning survive refresh", () => {
  const url = "https://manifests.kunai.test/providers.json";

  function setup() {
    const path = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const trusted = { "key-2026": publicPem };
    const sign = (manifest: ProviderHotfixManifest) =>
      signProviderManifest(manifest, privatePem, "key-2026");
    const install = (manifest: ProviderHotfixManifest, extra: { force?: boolean } = {}) =>
      fetchAndCacheProviderHotfixManifest({
        url,
        path,
        trustedPublicKeysById: trusted,
        nowMs: NOW_MS,
        fetchImpl: jsonFetch(sign(manifest)),
        ...extra,
      });
    const refresh = (manifest: ProviderHotfixManifest) =>
      maybeBackgroundRefreshProviderManifest({
        url,
        path,
        trustedPublicKeysById: trusted,
        nowMs: NOW_MS,
        minIntervalMs: 0,
        fetchImpl: jsonFetch(sign(manifest)),
      });
    return { path, trusted, install, refresh };
  }

  test("a different body re-signed under the same revision is refused after a cache purge", async () => {
    const { path, install } = setup();
    expect((await install(makeManifest({ revision: 5 }))).status).toBe("updated");
    rmSync(path);

    const swapped = makeManifest({
      revision: 5,
      providers: { rivestream: { baseUrl: "https://evil.example" } },
    });
    const result = await install(swapped);
    expect(result.status).toBe("rejected");
    // The identical body is still reinstallable after a purge.
    expect((await install(makeManifest({ revision: 5 }))).status).toBe("updated");
  });

  test("reset holds bundled defaults against the background refresh until an explicit update", async () => {
    const { path, install, refresh } = setup();
    expect((await install(makeManifest({ revision: 5 }))).status).toBe("updated");

    await resetCachedProviderHotfixManifest({ path, nowMs: NOW_MS });
    expect(existsSync(path)).toBe(false);
    expect(await refresh(makeManifest({ revision: 5 }))).toBe("skipped");
    expect(existsSync(path)).toBe(false);

    // An explicit update clears the hold, and refresh works again after it.
    expect((await install(makeManifest({ revision: 6 }))).status).toBe("updated");
    expect(await refresh(makeManifest({ revision: 7 }))).toBe("updated");
  });

  test("rollback is not undone by the next background refresh of the newer revision", async () => {
    const { path, trusted, install, refresh } = setup();
    expect((await install(makeManifest({ revision: 4 }))).status).toBe("updated");
    expect((await install(makeManifest({ revision: 5 }))).status).toBe("updated");

    const rolled = await rollbackCachedProviderHotfixManifest({
      path,
      trustedPublicKeysById: trusted,
      nowMs: NOW_MS,
    });
    expect(rolled.ok).toBe(true);

    expect(await refresh(makeManifest({ revision: 5 }))).toBe("skipped");
    const cached = loadCachedProviderHotfixManifest({
      path,
      trustedPublicKeysById: trusted,
      nowMs: NOW_MS,
    });
    expect(cached.status === "active" ? cached.manifest.revision : null).toBe(4);

    // `providers update` is the explicit way forward again.
    expect((await install(makeManifest({ revision: 5 }))).status).toBe("updated");
  });

  test("an AllManga rotation that names a buildId but is incomplete is refused at install", async () => {
    const { install } = setup();
    const result = await install(
      makeManifest({
        revision: 5,
        providers: { allanime: { cryptoOverrides: { buildId: "abc123", queryHash: "deadbeef" } } },
      }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toContain("AllManga");
    // A lone queryHash rotation (no buildId) is still a valid manifest.
    expect(
      (
        await install(
          makeManifest({
            revision: 6,
            providers: { allanime: { cryptoOverrides: { queryHash: "deadbeef" } } },
          }),
        )
      ).status,
    ).toBe("updated");
  });

  test("a directory at the lock path fails fast instead of spinning", async () => {
    const { path, install } = setup();
    const lockPath = `${providerManifestStatePath(path)}.lock`;
    mkdirSync(lockPath, { recursive: true });
    const old = new Date(NOW_MS - 10 * 60_000);
    utimesSync(lockPath, old, old);
    await expect(install(makeManifest({ revision: 5 }))).rejects.toThrow(/directory/);
  });
});

describe("urgent refresh after a provider goes down", () => {
  test("checks a cache fresher than the 6-hour interval, at most once per window", async () => {
    resetUrgentProviderManifestRefreshForTest();
    const path = makeTempCachePath();
    const { publicPem, privatePem } = makeKeypair();
    const trusted = { "key-2026": publicPem };
    let fetches = 0;
    const fetchImpl: ManifestFetch = async () => {
      fetches += 1;
      return new Response(
        JSON.stringify(signProviderManifest(makeManifest({ revision: 9 }), privatePem, "key-2026")),
        { status: 200 },
      );
    };
    const url = "https://manifests.kunai.test/providers.json";
    // A cache written 30 minutes ago: the background check would skip it.
    await fetchAndCacheProviderHotfixManifest({
      url,
      path,
      trustedPublicKeysById: trusted,
      nowMs: NOW_MS - 30 * 60_000,
      fetchImpl: jsonFetch(
        signProviderManifest(makeManifest({ revision: 8 }), privatePem, "key-2026"),
      ),
    });
    const old = new Date(NOW_MS - 30 * 60_000);
    utimesSync(path, old, old);

    expect(
      await maybeBackgroundRefreshProviderManifest({
        url,
        path,
        trustedPublicKeysById: trusted,
        nowMs: NOW_MS,
        fetchImpl,
      }),
    ).toBe("skipped");
    expect(fetches).toBe(0);

    expect(
      await maybeUrgentProviderManifestRefresh({
        url,
        path,
        trustedPublicKeysById: trusted,
        nowMs: NOW_MS,
        fetchImpl,
      }),
    ).toBe("updated");
    expect(fetches).toBe(1);

    // A second provider failing a minute later does not trigger another fetch.
    expect(
      await maybeUrgentProviderManifestRefresh({
        url,
        path,
        trustedPublicKeysById: trusted,
        nowMs: NOW_MS + 60_000,
        fetchImpl,
      }),
    ).toBe("skipped");
    expect(fetches).toBe(1);
  });

  test("reset goes through the manifest lock and writes the hold atomically", async () => {
    const path = makeTempCachePath();
    const statePath = providerManifestStatePath(path);
    writeFileSync(
      statePath,
      `${JSON.stringify({ highestRevision: 5, payloadSha256: "ab".repeat(32), hold: null })}\n`,
    );
    mkdirSync(`${statePath}.lock`);

    let blocked = false;
    try {
      await resetCachedProviderHotfixManifest({ path, nowMs: NOW_MS });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    expect(readFileSync(statePath, "utf8")).not.toContain('"hold": "reset"');

    rmSync(`${statePath}.lock`, { recursive: true });
    const reset = await resetCachedProviderHotfixManifest({ path, nowMs: NOW_MS });
    expect(reset.removed).toBe(false);
    // SAFETY: reset writes this state file as JSON via writeProviderManifestState.
    const written = JSON.parse(readFileSync(statePath, "utf8")) as {
      highestRevision: number;
      payloadSha256: string;
      hold: string;
      updatedAt: string;
    };
    expect(written).toEqual({
      highestRevision: 5,
      payloadSha256: "ab".repeat(32),
      hold: "reset",
      updatedAt: new Date(NOW_MS).toISOString(),
    });
  });

  test("a failed or oversized manifest response cancels the unread body", async () => {
    const path = makeTempCachePath();
    const { publicPem } = makeKeypair();
    const trusted = { "key-2026": publicPem };
    const url = "https://manifests.kunai.test/providers.json";

    const unread = (status: number, contentLength?: string) => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      });
      return {
        cancelled: () => cancelled,
        response: new Response(body, {
          status,
          headers: contentLength ? { "content-length": contentLength } : undefined,
        }),
      };
    };

    const httpError = unread(503);
    const rejected = await fetchAndCacheProviderHotfixManifest({
      url,
      path,
      trustedPublicKeysById: trusted,
      nowMs: NOW_MS,
      fetchImpl: async () => httpError.response,
    });
    expect(rejected.status).toBe("rejected");
    expect(httpError.cancelled()).toBe(true);

    const oversized = unread(200, String(MAX_MANIFEST_BYTES + 1));
    const tooBig = await fetchAndCacheProviderHotfixManifest({
      url,
      path,
      trustedPublicKeysById: trusted,
      nowMs: NOW_MS,
      fetchImpl: async () => oversized.response,
    });
    expect(tooBig.status).toBe("rejected");
    expect(oversized.cancelled()).toBe(true);
  });
});

test("an urgent check that skipped does not consume the window", async () => {
  resetUrgentProviderManifestRefreshForTest();
  // No URL configured: skipped without a request…
  expect(await maybeUrgentProviderManifestRefresh({ url: "", nowMs: NOW_MS })).toBe("skipped");
  // …so a configured attempt a minute later still runs.
  const path = makeTempCachePath();
  const { publicPem, privatePem } = makeKeypair();
  let fetches = 0;
  const outcome = await maybeUrgentProviderManifestRefresh({
    url: "https://manifests.kunai.test/providers.json",
    path,
    trustedPublicKeysById: { "key-2026": publicPem },
    nowMs: NOW_MS + 60_000,
    fetchImpl: async () => {
      fetches += 1;
      return new Response(
        JSON.stringify(signProviderManifest(makeManifest({ revision: 3 }), privatePem, "key-2026")),
        { status: 200 },
      );
    },
  });
  expect(outcome).toBe("updated");
  expect(fetches).toBe(1);
});
