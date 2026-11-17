import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCredentialVault } from "@/services/persistence/credential-vault-backends";
import { getKunaiPaths } from "@kunai/storage";

import { applyStorageRootEnv, storageRootEnv } from "../../../helpers/storage-env";

test("shadow analytics suppression restores an inherited DNT value", () => {
  const original = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = "0";
  const restore = applyStorageRootEnv("/unused/mock-profile");
  try {
    expect(process.env.DO_NOT_TRACK).toBe("1");
    restore();
    expect(process.env.DO_NOT_TRACK).toBe("0");
  } finally {
    restore();
    if (original === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = original;
  }
});

for (const platform of ["linux", "darwin", "win32"] as const) {
  test(`${platform}: a shadow profile never probes or reads the host credential vault`, async () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-shadow-vault-"));
    try {
      const env = storageRootEnv(root);
      let nativeCalls = 0;
      const vault = (
        await createCredentialVault({
          paths: getKunaiPaths({ env }),
          platform,
          env: { ...env, KUNAI_CREDENTIAL_BACKEND: "file" },
          which: () => {
            throw new Error("must not probe native vault in shadow profile");
          },
          spawn: async () => {
            nativeCalls++;
            return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
          },
        })
      ).vault;
      expect(vault.backend).toBe("file");
      expect(nativeCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
