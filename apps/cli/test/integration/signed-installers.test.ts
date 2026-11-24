import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderInstaller } from "../../../../scripts/packaging/render-installers";
import {
  createInstallerSandbox,
  hostInstallShAsset,
  withReleaseFixture,
} from "./helpers/installer-script-harness";

function installerShell(name: string) {
  return name === "install.ps1"
    ? Bun.which("pwsh")
    : process.platform !== "win32" && Bun.which("bash");
}

for (const name of ["install.sh", "install.ps1"] as const) {
  const shell = installerShell(name);
  test.skipIf(!shell).each(["valid", "modified", "missing", "unsigned archive"] as const)(
    `${name} enforces its embedded key: %s`,
    async (scenario) => {
      if (!shell) throw new Error("Missing shell");
      const sandbox = createInstallerSandbox("signed-install");
      try {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const script = join(sandbox.root, name);
        writeFileSync(
          script,
          renderInstaller(
            name,
            publicKey.export({ format: "der", type: "spki" }).toString("base64"),
          ),
        );
        const windows = name === "install.ps1";
        const asset = windows
          ? `kunai-windows-${process.arch === "arm64" ? "arm64" : "x64"}.exe`
          : hostInstallShAsset();
        const body = "#!/bin/sh\nexit 0\n";
        const sums = createHash("sha256").update(body).digest("hex") + "  " + asset + "\n";
        const prefix = "/download/v1.2.3/";
        await withReleaseFixture(
          {
            [prefix + asset]: { body },
            [prefix + "SHA256SUMS"]: { body: sums },
            [prefix + "SHA256SUMS.archives"]:
              scenario === "unsigned archive" ? { body: sums } : { status: 404 },
            [prefix + "SHA256SUMS.sig"]:
              scenario === "missing"
                ? { status: 404 }
                : {
                    body: sign(
                      null,
                      Buffer.from(scenario === "modified" ? sums + "\n" : sums),
                      privateKey,
                    ),
                  },
          },
          async (base) => {
            const args = windows
              ? ["-NoProfile", "-File", script, "-Version", "1.2.3", "-Yes", "-SkipDeps"]
              : [script, "--version", "1.2.3", "--yes", "--skip-deps"];
            const child = Bun.spawn([shell, ...args], {
              stdout: "pipe",
              stderr: "pipe",
              env: { ...sandbox.env, KUNAI_DL_BASE: base, KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1" },
            });
            const [stdout, stderr, status] = await Promise.all([
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
              child.exited,
            ]);
            if (scenario === "valid" && status !== 0) throw new Error(stdout + stderr);
            expect(status === 0).toBe(scenario === "valid");
            expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(scenario === "valid");
            if (scenario !== "valid") expect(stdout + stderr).toMatch(/sig(nature)?/i);
          },
        );
      } finally {
        sandbox.cleanup();
      }
    },
  );
}
