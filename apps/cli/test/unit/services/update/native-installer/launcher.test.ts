import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  atomicInstallBinaryFromFile,
  atomicWriteBinary,
  updateLauncher,
} from "@/services/update/native-installer/launcher";

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

  test("atomicInstallBinaryFromFile copies staged bytes into place", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-atomic-file-"));
    const source = join(root, "staged.bin");
    const target = join(root, "versions", "1.2.3", "kunai");
    await mkdir(join(root, "versions", "1.2.3"), { recursive: true });
    await writeFile(source, "STAGED");
    await atomicInstallBinaryFromFile(source, target);
    expect(await Bun.file(target).text()).toBe("STAGED");
    expect(await Bun.file(source).text()).toBe("STAGED");
    await rm(root, { recursive: true, force: true });
  });
});
