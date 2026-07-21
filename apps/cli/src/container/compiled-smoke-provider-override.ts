import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { CoreProviderModule } from "@kunai/core";

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

  const fixture = await import("../app/compiled-smoke/fixture-provider");
  return fixture.providerModules;
}
