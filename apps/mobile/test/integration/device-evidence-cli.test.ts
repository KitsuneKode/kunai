import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MobileBuildMetadata, MobileTargetId } from "../../scripts/build-contract";
import type { MobileDeviceEvidence } from "../live/device-host-proof";

const MOBILE_ROOT = join(import.meta.dir, "../..");
const METADATA_PATH = join(MOBILE_ROOT, "dist/mobile-build-meta.json");
const VALIDATOR_PATH = join(MOBILE_ROOT, "test/live/device-host-proof.ts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function artifactSetHash(metadata: MobileBuildMetadata, target: MobileTargetId): string {
  const artifactSet = metadata.artifactSets.find((candidate) => candidate.target === target);
  if (!artifactSet) throw new Error(`missing test artifact set: ${target}`);
  return artifactSet.sha256;
}

function evidence(
  metadata: MobileBuildMetadata,
  platform: "android" | "ios",
): MobileDeviceEvidence {
  const android = platform === "android";
  const artifactTarget = android ? "android-termux-node" : "ios-ashell";
  return {
    schemaVersion: 2,
    kunaiVersion: metadata.version,
    platform,
    osVersion: android ? "15" : "19.6.2",
    terminal: android ? "termux" : "a-shell-mini",
    terminalVersion: android ? "0.119.0-beta.3" : "1.15.11",
    runtimeVersion: android ? "v22.18.0" : "iOS 19.6.2",
    architecture: "arm64",
    player: "vlc",
    playerVersion: "3.7.0",
    deviceClass: "physical",
    artifactTarget,
    artifactSetSha256: artifactSetHash(metadata, artifactTarget),
    terminalInput: "passed",
    http: "passed",
    stateRecovery: "passed",
    cancellation: "passed",
    handoffAccepted: true,
    playbackBegan: true,
    recordedAt: "2026-09-03T00:00:00.000Z",
  };
}

describe("mobile device evidence CLI", () => {
  test("accepts only a complete metadata-bound physical matrix and prints redacted rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kunai-mobile-evidence-"));
    temporaryDirectories.push(directory);
    const metadata = JSON.parse(await readFile(METADATA_PATH, "utf8")) as MobileBuildMetadata;
    const androidPath = join(directory, "android.json");
    const iosPath = join(directory, "ios.json");
    await writeFile(androidPath, JSON.stringify(evidence(metadata, "android")));
    await writeFile(iosPath, JSON.stringify(evidence(metadata, "ios")));

    const result = Bun.spawnSync([
      process.execPath,
      VALIDATOR_PATH,
      "--metadata",
      METADATA_PATH,
      "--evidence",
      androidPath,
      "--evidence",
      iosPath,
    ]);
    const stdout = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(stdout).toContain("android | 15 | termux");
    expect(stdout).toContain("ios | 19.6.2 | a-shell-mini");
    expect(stdout).toContain("Mobile physical-device qualification matrix passed.");
    expect(stdout).not.toContain(artifactSetHash(metadata, "android-termux-node"));
    expect(stdout).not.toContain(artifactSetHash(metadata, "ios-ashell"));
  });

  test("rejects a claimed row whose artifact set is not in the generated metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kunai-mobile-evidence-"));
    temporaryDirectories.push(directory);
    const metadata = JSON.parse(await readFile(METADATA_PATH, "utf8")) as MobileBuildMetadata;
    const androidPath = join(directory, "android.json");
    const iosPath = join(directory, "ios.json");
    await writeFile(
      androidPath,
      JSON.stringify({ ...evidence(metadata, "android"), artifactSetSha256: "c".repeat(64) }),
    );
    await writeFile(iosPath, JSON.stringify(evidence(metadata, "ios")));

    const result = Bun.spawnSync([
      process.execPath,
      VALIDATOR_PATH,
      "--metadata",
      METADATA_PATH,
      "--evidence",
      androidPath,
      "--evidence",
      iosPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("does not match the generated artifact set");
    expect(result.stderr.toString()).not.toContain("c".repeat(64));
  });
});
