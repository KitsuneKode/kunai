import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  releaseSupplements,
  SUPPLEMENT_NAMES,
} from "../../../../../scripts/packaging/release-supplements";
import { signedStatementBytes } from "../../support/release-signing";

test("protected signing and independent verification bind every channel to the preserved manifests", () => {
  const native = mkdtempSync(join(tmpdir(), "kunai-sign-"));
  try {
    const directory = join(native, "channels");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const input = {
      version: "1.2.3",
      native,
      directory,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    };
    const secret = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    writeFileSync(join(native, "SHA256SUMS"), "raw manifest");
    writeFileSync(
      join(native, "SHA256SUMS.archives"),
      RELEASE_BINARY_TARGETS.map((t) => "a".repeat(64) + "  " + t.archiveName).join("\n"),
    );
    expect(() => releaseSupplements({ ...input, mode: "prepare" })).toThrow("protected checksum");
    for (const name of SUPPLEMENT_NAMES) {
      releaseSupplements({ ...input, mode: "prepare", privateKey: secret });
      releaseSupplements({ ...input, mode: "verify" });
      writeFileSync(join(directory, name), "changed");
      expect(() => releaseSupplements({ ...input, mode: "verify" })).toThrow();
    }
    const wrongKey = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => releaseSupplements({ ...input, mode: "prepare", privateKey: wrongKey })).toThrow(
      "signature",
    );
    releaseSupplements({ ...input, mode: "prepare", privateKey: secret });
    // Each signature covers the version-bound statement, never the raw manifest.
    for (const name of ["SHA256SUMS", "SHA256SUMS.archives"] as const) {
      const manifest = readFileSync(join(native, name));
      const signature = readFileSync(join(directory, name + ".sig"));
      expect(
        verify(null, signedStatementBytes("valid", "1.2.3", name, manifest), publicKey, signature),
      ).toBe(true);
      expect(verify(null, manifest, publicKey, signature)).toBe(false);
    }
    // A signed set prepared for 1.2.3 does not verify as any other release.
    expect(() => releaseSupplements({ ...input, version: "1.2.4", mode: "verify" })).toThrow(
      "signature",
    );
    writeFileSync(join(native, "SHA256SUMS"), "different bytes");
    expect(() => releaseSupplements({ ...input, mode: "verify" })).toThrow("signature");
  } finally {
    rmSync(native, { recursive: true, force: true });
  }
});
