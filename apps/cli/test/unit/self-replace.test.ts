import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertReleaseSignature,
  cleanupOldBinary,
  pickChecksum,
  releasePublicKeyOverride,
  selfReplace,
  verifyChecksum,
  verifyReleaseSignature,
} from "@/services/update/self-replace";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

test("pickChecksum finds the matching line in SHA256SUMS", () => {
  const sums = "aaaa  kunai-linux-x64\nbbbb  kunai-darwin-arm64\n";
  expect(pickChecksum(sums, "kunai-darwin-arm64")).toBe("bbbb");
  expect(pickChecksum(sums, "kunai-missing")).toBeNull();
});

test("an empty release-key override keeps the embedded public key", () => {
  const previous = process.env.KUNAI_RELEASE_ED25519_PUBLIC_KEY;
  process.env.KUNAI_RELEASE_ED25519_PUBLIC_KEY = "  fixture-key\n";
  expect(releasePublicKeyOverride()).toBe("fixture-key");
  delete process.env.KUNAI_RELEASE_ED25519_PUBLIC_KEY;
  expect(releasePublicKeyOverride()).toBeUndefined();
  if (previous !== undefined) process.env.KUNAI_RELEASE_ED25519_PUBLIC_KEY = previous;
});

test("verifyChecksum rejects a mismatch and empty input", () => {
  expect(verifyChecksum("dead", "beef")).toBe(false);
  expect(verifyChecksum("", "")).toBe(false);
  expect(verifyChecksum("beef", "beef")).toBe(true);
});

test("selfReplace writes verified bytes over the target (posix path)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-replace-"));
  made.push(dir);
  const bin = join(dir, "kunai");
  await Bun.write(bin, "OLD");
  const next = "NEWBINARY";

  await selfReplace({
    binPath: bin,
    bytes: new TextEncoder().encode(next),
    expectedSha256: sha256Hex(next),
    platform: "linux",
  });

  expect(await Bun.file(bin).text()).toBe(next);
});

test("selfReplace aborts on checksum mismatch and leaves the old binary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-replace-"));
  made.push(dir);
  const bin = join(dir, "kunai");
  await Bun.write(bin, "OLD");

  await expect(
    selfReplace({
      binPath: bin,
      bytes: new TextEncoder().encode("NEW"),
      expectedSha256: "deadbeef",
      platform: "linux",
    }),
  ).rejects.toThrow(/Checksum mismatch/);
  expect(await Bun.file(bin).text()).toBe("OLD");
});

test("win32 path renames the running binary aside to .old", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-replace-"));
  made.push(dir);
  const bin = join(dir, "kunai.exe");
  await Bun.write(bin, "OLD");
  const next = "NEWEXE";

  await selfReplace({
    binPath: bin,
    bytes: new TextEncoder().encode(next),
    expectedSha256: sha256Hex(next),
    platform: "win32",
  });

  expect(await Bun.file(bin).text()).toBe(next);
  expect(existsSync(`${bin}.old`)).toBe(true);
  expect(await Bun.file(`${bin}.old`).text()).toBe("OLD");
});

test("a checksum match without a valid signature is a failure", () => {
  const message = new TextEncoder().encode("abc  kunai\n");
  expect(() => assertReleaseSignature(message, undefined)).toThrow(
    "checksum match without a valid signature is a failure",
  );
  const keys = generateKeyPairSync("ed25519");
  const pem = keys.publicKey.export({ type: "spki", format: "pem" }) as string;
  const signature = sign(null, message, keys.privateKey);
  expect(verifyReleaseSignature(message, signature, pem)).toBe(true);
  const other = generateKeyPairSync("ed25519");
  const forged = sign(null, message, other.privateKey);
  expect(() => assertReleaseSignature(message, forged, pem)).toThrow(
    "checksum match without a valid signature is a failure",
  );
});

test("cleanupOldBinary removes stale .old files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-replace-"));
  made.push(dir);
  const bin = join(dir, "kunai.exe");
  await Bun.write(bin, "CUR");
  await Bun.write(`${bin}.old`, "STALE");

  await cleanupOldBinary(bin);

  expect(existsSync(`${bin}.old`)).toBe(false);
  expect(existsSync(bin)).toBe(true);
});
