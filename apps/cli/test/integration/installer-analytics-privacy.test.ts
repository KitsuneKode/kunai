import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { storageRootEnv } from "../helpers/storage-env";
import {
  createInstallerSandbox,
  windowsShellEnvDefaults,
} from "./helpers/installer-script-harness";

test("installer fixture environments explicitly suppress analytics", () => {
  const fixture = createInstallerSandbox("analytics-env");
  try {
    expect(windowsShellEnvDefaults(fixture.root).DO_NOT_TRACK).toBe("1");
    expect(fixture.env.DO_NOT_TRACK).toBe("1");
  } finally {
    fixture.cleanup();
  }
});

for (const platform of ["linux", "darwin", "win32"] as const) {
  test(`${platform}: installer fixture contains CLI config, data and cache roots`, () => {
    const fixture = createInstallerSandbox("analytics-roots");
    try {
      const paths = getKunaiPaths({ platform, env: fixture.env });
      const targetPath = platform === "win32" ? win32 : posix;
      for (const path of [paths.configDir, paths.dataDir, paths.cacheDir]) {
        expect(targetPath.relative(fixture.root, path).startsWith("..")).toBe(false);
      }
    } finally {
      fixture.cleanup();
    }
  });
}

test.skipIf(process.platform === "win32")(
  "native Docker smoke suppresses analytics before launching a binary",
  () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-installer-privacy-"));
    try {
      const bashEnv = join(root, "probe.sh");
      // Invalid variant exits before any install or profile mutation. Capture the
      // runner's real exported environment at exit, rather than testing its text.
      writeFileSync(bashEnv, `trap 'printf "privacy-dnt=%s\\n" "\${DO_NOT_TRACK:-unset}"' EXIT\n`);
      const result = Bun.spawnSync(
        [
          "bash",
          resolve(import.meta.dir, "../docker/native-installer/smoke.sh"),
          "invalid-fixture-variant",
        ],
        {
          env: {
            ...process.env,
            ...storageRootEnv(root),
            BASH_ENV: bashEnv,
            DO_NOT_TRACK: "0",
            CI: "0",
            KUNAI_TEST_HOME: root,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain("privacy-dnt=1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
