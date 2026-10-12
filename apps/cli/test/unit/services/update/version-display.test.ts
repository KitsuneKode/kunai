import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatVersionLine, versionChannelLabel } from "@/services/update/version-display";

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
    ).toBe(`kunai 1.2.3 (${label})`);
  });
}

test("labels a source checkout without nested detected parens", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "kunai-version-source-"));
  made.push(configDir);

  expect(
    await formatVersionLine("1.2.3", {
      configDir,
      detectInstallMethodInput: {
        cwd: "/repo/kunai/apps/cli",
        entrypoint: "/repo/kunai/apps/cli/src/main.ts",
        platform: "linux",
        fileExists: (candidate) =>
          candidate === "/repo/kunai/package.json" ||
          candidate === "/repo/kunai/apps/cli/src/main.ts" ||
          candidate === "/repo/kunai/.git",
      },
    }),
  ).toBe("kunai 1.2.3 (source)");
});

test("labels a packaged binary as binary", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "kunai-version-binary-"));
  made.push(configDir);

  expect(
    await formatVersionLine("1.2.3", {
      configDir,
      detectInstallMethodInput: {
        cwd: "/tmp",
        entrypoint: "/opt/kunai/kunai",
        packagedBinary: true,
        fileExists: () => false,
      },
    }),
  ).toBe("kunai 1.2.3 (binary)");
});

test("labels an undetermined script run as dev", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "kunai-version-dev-"));
  made.push(configDir);

  expect(
    await formatVersionLine("1.2.3", {
      configDir,
      detectInstallMethodInput: {
        cwd: "/tmp",
        entrypoint: "/tmp/kunai.js",
        fileExists: () => false,
      },
    }),
  ).toBe("kunai 1.2.3 (dev)");
});

test("versionChannelLabel maps unknown to dev and leaves other channels intact", () => {
  expect(versionChannelLabel("unknown")).toBe("dev");
  expect(versionChannelLabel("source")).toBe("source");
  expect(versionChannelLabel("binary")).toBe("binary");
  expect(versionChannelLabel("npm-global")).toBe("npm-global");
  expect(versionChannelLabel("bun-global")).toBe("bun-global");
});
