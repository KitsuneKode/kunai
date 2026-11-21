import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CREDENTIAL_VAULT_PROBE_KEY } from "@/services/persistence/credential-vault";
import { createCredentialVault } from "@/services/persistence/credential-vault-backends";
import { getKunaiPaths } from "@kunai/storage";

function describeRealVault(): typeof describe {
  return process.platform === "win32" && process.env.KUNAI_CI_REAL_VAULT === "1"
    ? describe
    : describe.skip;
}

describeRealVault()("Windows credential vault", () => {
  let appData: string;
  let restoreAppData: string | undefined;

  afterEach(() => {
    if (restoreAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = restoreAppData;
    rmSync(appData, { recursive: true, force: true });
  });

  test("PasswordVault round-trip through createCredentialVault", async () => {
    appData = mkdtempSync(join(tmpdir(), "kunai-wincred-appdata-"));
    restoreAppData = process.env.APPDATA;
    process.env.APPDATA = appData;
    const paths = getKunaiPaths({ env: process.env });
    const { vault } = await createCredentialVault({ paths, platform: "win32" });
    expect(vault.backend).toBe("wincred");

    const key = `fixture.${CREDENTIAL_VAULT_PROBE_KEY}`;
    await vault.set(key, "integration-probe");
    expect(await vault.get(key)).toBe("integration-probe");
    await vault.delete(key);
    expect(await vault.get(key)).toBeUndefined();
  });
});
