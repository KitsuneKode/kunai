import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  releaseSupplements,
  SUPPLEMENT_NAMES,
} from "../../../../../scripts/packaging/release-supplements";

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
    writeFileSync(join(native, "SHA256SUMS"), "different bytes");
    expect(() => releaseSupplements({ ...input, mode: "verify" })).toThrow("signature");
  } finally {
    rmSync(native, { recursive: true, force: true });
  }
});
