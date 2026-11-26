import { afterEach, describe, expect, test } from "bun:test";
import { createPrivateKey, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  releaseManifestStatement,
  verifyReleaseManifestSignature,
} from "@/services/update/checksum-signature";

import {
  assertNothingPinned,
  generateSigningMaterial,
  writeBackups,
  writePins,
} from "../../../../../scripts/setup-signing-keys";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kunai-keys-root-"));
  dirs.push(root);
  mkdirSync(join(root, "apps/cli/src/services/update"), { recursive: true });
  mkdirSync(join(root, "apps/cli/src/services/providers"), { recursive: true });
  writeFileSync(
    join(root, "apps/cli/src/services/update/release-key.json"),
    '{ "ed25519Spki": "" }\n',
  );
  writeFileSync(
    join(root, "apps/cli/src/services/providers/provider-manifest-pin.json"),
    JSON.stringify({ url: "https://example.invalid/m.json", publicKeysById: {} }),
  );
  return root;
}

describe("setup-signing-keys", () => {
  test("the pinned release key verifies what the private key signs, as the updater checks it", () => {
    const material = generateSigningMaterial(new Date("2026-11-26T00:00:00Z"));
    const manifest = new TextEncoder().encode("abc  kunai-linux-x64.tar.gz\n");
    const statement = releaseManifestStatement("0.4.0", "SHA256SUMS", manifest);
    const signature = sign(
      null,
      Buffer.from(statement),
      createPrivateKey(material.releasePrivatePem),
    );
    expect(() =>
      verifyReleaseManifestSignature({
        version: "0.4.0",
        name: "SHA256SUMS",
        manifest,
        signature,
        spki: material.releaseSpki,
      }),
    ).not.toThrow();
    expect(material.manifestKeyId).toBe("kunai-manifest-202611");
  });

  test("pins carry public halves only, and a pinned key refuses a second run", () => {
    const root = fakeRoot();
    assertNothingPinned(root);
    const material = generateSigningMaterial();
    writePins(root, material);
    const release = readFileSync(
      join(root, "apps/cli/src/services/update/release-key.json"),
      "utf8",
    );
    const pin = readFileSync(
      join(root, "apps/cli/src/services/providers/provider-manifest-pin.json"),
      "utf8",
    );
    expect(JSON.parse(release).ed25519Spki).toBe(material.releaseSpki);
    expect(JSON.parse(pin).publicKeysById[material.manifestKeyId]).toBe(material.manifestPublicPem);
    expect(`${release}${pin}`).not.toContain("PRIVATE KEY");
    expect(() => assertNothingPinned(root)).toThrow("already pins a release key");
  });

  test("private backups are owner-only and never overwritten", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kunai-keys-backup-")), "keys");
    dirs.push(dir);
    const material = generateSigningMaterial();
    const paths = writeBackups(dir, material);
    for (const path of paths) expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(() => writeBackups(dir, material)).toThrow();
  });
});
