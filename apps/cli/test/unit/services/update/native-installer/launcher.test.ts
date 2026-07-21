import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  atomicInstallBinaryFromFile,
  atomicWriteBinary,
  inspectLauncherOwnership,
  removeLauncherCopyAsides,
  removeLauncherIfVersioned,
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

  test("Unix ownership requires symlink into versions dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-launcher-own-"));
    const versionsDir = join(root, "versions");
    const versionPath = join(versionsDir, "1.0.0", "kunai");
    const launcherPath = join(root, "bin", "kunai");
    await mkdir(join(versionsDir, "1.0.0"), { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(versionPath, "bin");
    await updateLauncher({ launcherPath, versionPath, platform: "linux" });

    expect(
      await inspectLauncherOwnership({
        launcherPath,
        versionsDir,
        platform: "linux",
      }),
    ).toBe("managed");

    await rm(launcherPath, { force: true });
    await writeFile(launcherPath, "foreign");
    expect(
      await inspectLauncherOwnership({
        launcherPath,
        versionsDir,
        platform: "linux",
      }),
    ).toBe("unmanaged");

    await rm(root, { recursive: true, force: true });
  });

  test("Windows ownership requires checksum match, never size alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-launcher-win-"));
    const versionsDir = join(root, "versions");
    const launcherPath = join(root, "bin", "kunai.exe");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(versionsDir, { recursive: true });

    const bytes = new TextEncoder().encode("owned-windows-binary");
    const sha = createHash("sha256").update(bytes).digest("hex");
    await writeFile(launcherPath, bytes);

    expect(
      await inspectLauncherOwnership({
        launcherPath,
        versionsDir,
        expectedSha256: sha,
        platform: "win32",
      }),
    ).toBe("managed");

    expect(
      await inspectLauncherOwnership({
        launcherPath,
        versionsDir,
        expectedSha256: "0".repeat(64),
        platform: "win32",
      }),
    ).toBe("unmanaged");

    // Same size, wrong content → unmanaged
    const wrong = new TextEncoder().encode("xxxxx-windows-binary");
    expect(wrong.byteLength).toBe(bytes.byteLength);
    await writeFile(launcherPath, wrong);
    expect(
      await inspectLauncherOwnership({
        launcherPath,
        versionsDir,
        expectedSha256: sha,
        platform: "win32",
      }),
    ).toBe("unmanaged");

    await rm(root, { recursive: true, force: true });
  });

  test("removes owned Windows copy-asides beside the launcher", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-launcher-aside-"));
    const launcherPath = join(root, "bin", "kunai.exe");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(launcherPath, "current");
    const aside = `${launcherPath}.old.1710000000000`;
    const foreign = join(root, "bin", "other.exe.old.1");
    await writeFile(aside, "previous");
    await writeFile(foreign, "leave-me");

    const removed = await removeLauncherCopyAsides(launcherPath);
    expect(removed).toEqual([aside]);
    expect(existsSync(aside)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(launcherPath)).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  test("removeLauncherIfVersioned refuses unmanaged Windows launcher", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-launcher-refuse-"));
    const versionsDir = join(root, "versions");
    const launcherPath = join(root, "bin", "kunai.exe");
    await mkdir(versionsDir, { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(launcherPath, "foreign");

    const removed = await removeLauncherIfVersioned({
      launcherPath,
      versionsDir,
      expectedSha256: createHash("sha256").update("owned").digest("hex"),
      platform: "win32",
    });
    expect(removed).toBe(false);
    expect(existsSync(launcherPath)).toBe(true);

    await rm(root, { recursive: true, force: true });
  });
});
