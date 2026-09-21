import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { CoreProviderModule } from "@kunai/core";

import type { SearchServiceDefinition } from "../services/search/SearchService";

/**
 * Load test-only provider modules for compiled-binary smokes.
 * Requires both `KUNAI_COMPILED_SMOKE=1` and an absolute fixture path that exists.
 * Modules are bundled into the binary (compiled executables cannot resolve
 * workspace package imports from an external test file at runtime).
 * Production startup leaves the env unset and never evaluates this path.
 */
export async function loadCompiledSmokeProviderOverride(): Promise<
  readonly CoreProviderModule[] | undefined
> {
  const fixture = await loadValidatedFixture();
  return fixture?.providerModules;
}

/**
 * Search-registry counterpart to {@link loadCompiledSmokeProviderOverride}.
 * Provider modules alone do not cover typed search: the session's catalog
 * queries go through `searchRegistry` (TMDB/AniList), which is a separate
 * seam. Without this override a typed search under `KUNAI_COMPILED_SMOKE=1`
 * still hits the real catalog. Same env gates, same validation.
 */
export async function loadCompiledSmokeSearchDefinitions(): Promise<
  readonly SearchServiceDefinition[] | undefined
> {
  const fixture = await loadValidatedFixture();
  return fixture?.searchServiceDefinitions;
}

async function loadValidatedFixture() {
  if (process.env.KUNAI_COMPILED_SMOKE !== "1") return undefined;

  const fixturePath = process.env.KUNAI_COMPILED_SMOKE_FIXTURE?.trim();
  if (!fixturePath) {
    throw new Error(
      "KUNAI_COMPILED_SMOKE=1 requires KUNAI_COMPILED_SMOKE_FIXTURE (absolute path to fixture module)",
    );
  }
  if (!isAbsolute(fixturePath)) {
    throw new Error(
      `KUNAI_COMPILED_SMOKE_FIXTURE must be an absolute path (got ${JSON.stringify(fixturePath)})`,
    );
  }
  if (!existsSync(fixturePath)) {
    throw new Error(`KUNAI_COMPILED_SMOKE_FIXTURE does not exist: ${fixturePath}`);
  }

  return import("../app/compiled-smoke/fixture-provider");
}
