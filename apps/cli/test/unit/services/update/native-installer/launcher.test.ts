import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteBinary, updateLauncher } from "@/services/update/native-installer/launcher";

describe("launcher", () => {
  test("updates unix symlink to versioned binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-launcher-"));
    const versionPath = join(root, "versions", "1.0.0", "kunai");
    const launcherPath = join(root, "bin", "kunai");
    await mkdir(join(root, "versions", "1.0.0"), { recursive: true });
    await writeFile(versionPath, "#!/bin/sh\necho kunai\n");
    await mkdir(join(root, "bin"), { recursive: true });

    await updateLauncher({ launcherPath, versionPath, platform: "linux" });
    const target = await readlink(launcherPath);
    expect(target).toBe(versionPath);

    await rm(root, { recursive: true, force: true });
  });

  test("atomicWriteBinary writes executable bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-atomic-"));
    const target = join(root, "kunai");
    await mkdir(root, { recursive: true });
    await atomicWriteBinary(target, new TextEncoder().encode("binary"));
    const file = Bun.file(target);
    expect(await file.exists()).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
