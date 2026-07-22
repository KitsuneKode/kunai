import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatVersionLine } from "@/services/update/version-display";

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const [manager, label] of [
  ["npm", "npm-global"],
  ["bun", "bun-global"],
] as const) {
  test(`labels a no-manifest compiled child as ${label}`, async () => {
    const configDir = await mkdtemp(join(tmpdir(), `kunai-version-${manager}-`));
    made.push(configDir);

    expect(
      await formatVersionLine("1.2.3", {
        configDir,
        detectInstallMethodInput: {
          packagedBinary: true,
          env: {
            KUNAI_MANAGED_PACKAGE_MANAGER: manager,
            KUNAI_MANAGED_PACKAGE_ROOT: join(configDir, "package"),
          },
        },
      }),
    ).toBe(`kunai 1.2.3 (${label} (detected))`);
  });
}
