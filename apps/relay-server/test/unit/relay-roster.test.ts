import { expect, test } from "bun:test";

import { relayRegistry } from "../../src/provider-registry";

/**
 * Roster parity: every provider manifest that declares a `relayProfile` must be
 * registered on the relay. The registry previously drifted — five production
 * providers answered `unknown-provider` — and the drift check derives its
 * probes from the same registry, so it could not see the gap. Manifests are
 * discovered from disk so a new relayable provider fails this test even before
 * it is added to a hand-maintained list.
 */
test("every relayable provider manifest is registered on the relay", async () => {
  // test/unit → test → relay-server → apps → repo root
  const providersSrc = new URL("../../../../packages/providers/src/", import.meta.url).pathname;
  const glob = new Bun.Glob("*/manifest.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: providersSrc, onlyFiles: true })) {
    files.push(file);
  }
  expect(files.length).toBeGreaterThan(0);

  // Dormant providers keep a relayProfile in their manifest but are not part of
  // the production roster, so they must not be served by the relay.
  const DORMANT_PROVIDERS = new Set(["rgshows"]);

  const relayable = new Set<string>();
  for (const file of files) {
    const mod = (await import(`${providersSrc}${file}`)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as { id?: unknown; relayProfile?: unknown };
      if (
        typeof candidate.id === "string" &&
        candidate.relayProfile &&
        !DORMANT_PROVIDERS.has(candidate.id)
      ) {
        relayable.add(candidate.id);
      }
    }
  }

  expect(relayable.size).toBeGreaterThan(0);
  const registered = new Set(relayRegistry.providers.map((entry) => entry.providerId));
  for (const providerId of relayable) {
    expect(
      registered.has(providerId),
      `provider "${providerId}" declares relayProfile but is missing from the relay registry`,
    ).toBe(true);
  }
});

test("the relay registry serves the providers the audit found missing", () => {
  const registered = relayRegistry.providers.map((entry) => entry.providerId);
  for (const providerId of ["vidrock", "movy", "hianime", "animegg", "kickassanime"]) {
    expect(registered).toContain(providerId);
  }
});
