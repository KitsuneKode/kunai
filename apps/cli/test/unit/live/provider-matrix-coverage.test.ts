import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MATRIX } from "../../live/provider-matrix-entries";

/**
 * The matrix exists so no production provider can go dark between releases —
 * but it only proves that for providers with a row. The roster used to drift:
 * five registered providers (movy, vidrock, hianime, kickassanime, animegg)
 * shipped with no matrix row at all while the README claimed full coverage.
 * Deriving the roster from `loadProductionProviderModules()` means registering
 * a provider without a row fails here on its own.
 */
const BOOTSTRAP_PROVIDERS = join(import.meta.dir, "../../../src/container/bootstrap-providers.ts");
const PROVIDER_MODULES = join(import.meta.dir, "../../../../../packages/providers/src");

/**
 * Registered provider ids, not module paths — they differ: the `allmanga`
 * module registers as provider id `allanime`, and the matrix row has to name
 * what `providerRegistry.get()` resolves.
 */
const PRODUCTION_PROVIDERS = [
  ...new Set(
    [
      ...readFileSync(BOOTSTRAP_PROVIDERS, "utf8").matchAll(
        /import\("@kunai\/providers\/([^"]+)"\)/g,
      ),
    ]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .map((modulePath) => {
        const manifest = readFileSync(join(PROVIDER_MODULES, modulePath, "manifest.ts"), "utf8");
        const constName = /id:\s*(\w+_PROVIDER_ID)/.exec(manifest)?.[1];
        const literal =
          constName === undefined
            ? undefined
            : new RegExp(`const\\s+${constName}\\s*=\\s*"([^"]+)"`).exec(manifest)?.[1];
        return literal ?? modulePath;
      }),
  ),
];

describe("provider matrix coverage", () => {
  test("every registered production provider has a matrix row", () => {
    const covered = new Set(MATRIX.map((entry) => entry.provider));
    const missing = PRODUCTION_PROVIDERS.filter((provider) => !covered.has(provider));

    expect(missing).toEqual([]);
  });

  test("no matrix row names a provider that is not registered", () => {
    const registered = new Set(PRODUCTION_PROVIDERS);
    const stale = MATRIX.filter((entry) => !registered.has(entry.provider)).map(
      (entry) => entry.provider,
    );

    expect(stale).toEqual([]);
  });

  test.each(MATRIX.map((entry) => entry.provider))("the %s smoke file exists", (provider) => {
    const entry = MATRIX.find((item) => item.provider === provider);
    // Rows launched via `bun -e "await import('...')"` carry the path inside
    // the eval string, so it is extracted rather than matched on arg end.
    const script = entry?.command
      .map((arg) => /test\/live\/[\w.-]+\.smoke\.ts/.exec(arg)?.[0])
      .find((match) => match !== undefined);

    expect(script).toBeDefined();
    expect(() =>
      readFileSync(join(import.meta.dir, "../../../", script ?? ""), "utf8"),
    ).not.toThrow();
  });
});
