import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCredentialVault } from "@/services/persistence/credential-vault-backends";
import { getKunaiPaths } from "@kunai/storage";

import { storageRootEnv } from "../../../helpers/storage-env";

for (const platform of ["linux", "darwin", "win32"] as const) {
  test(`${platform}: a shadow profile never probes or reads the host credential vault`, async () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-shadow-vault-"));
    try {
      const env = storageRootEnv(root);
      let nativeCalls = 0;
      const vault = await createCredentialVault({
        paths: getKunaiPaths({ env }),
        platform,
        env,
        which: () => "/fixture/native-vault-tool",
        spawn: async () => {
          nativeCalls++;
          return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
        },
      });
      expect(vault.backend).toBe("file");
      await vault.set("fixture.shadow-secret", "owned test value");
      expect(await vault.get("fixture.shadow-secret")).toBe("owned test value");
      await vault.delete("fixture.shadow-secret");
      expect(await vault.get("fixture.shadow-secret")).toBeUndefined();
      expect(nativeCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
