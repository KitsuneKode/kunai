import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../../../helpers/storage-env";

// Isolate the real provider exports from the process-global recommendation mocks.
test.each(["empty", "unavailable"])(
  "YouTube %s trending terminates and remains retryable",
  (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "kunai-discovery-bounds-"));
    try {
      const result = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
      import { strict as assert } from "node:assert";
      import { CatalogDiscoveryService } from "./src/services/catalog/CatalogDiscoveryService.ts";
      import { configureYoutubeProvider } from "@kunai/providers/youtube";
      configureYoutubeProvider({ invidiousInstanceUrl: "https://discovery.example.test" });
      const unavailable = ${JSON.stringify(scenario === "unavailable")};
      const controller = new AbortController();
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (requests.length > 8) controller.abort(new Error("Cyclic discovery requests"));
        return Response.json([], { status: unavailable ? 503 : 200 });
      };
      const service = new CatalogDiscoveryService();
      for (let attempt = 1; attempt <= 2; attempt++) {
        const previousCount = requests.length;
        if (unavailable) await assert.rejects(service.loadTrending("youtube", controller.signal), /503/);
        else assert.deepEqual(await service.loadTrending("youtube", controller.signal), []);
        assert.ok(requests.length > previousCount);
        assert.ok(requests.length <= attempt * 3);
      }
      assert.ok(requests.every((url) => url.includes("/api/v1/trending?") || (unavailable && url.includes("/instances.json"))));
    `,
        ],
        {
          cwd: resolve(import.meta.dir, "../../../.."),
          env: { ...process.env, ...storageRootEnv(root) },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
