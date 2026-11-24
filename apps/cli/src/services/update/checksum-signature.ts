import { createHash, createPublicKey, verify } from "node:crypto";

import { parseCanonicalVersion } from "./version";

declare global {
  interface ImportMeta {
    readonly kunaiReleasePublicKey?: string;
  }
}

/** The release build inlines the pin. Source runs have no build metadata. */
export const embeddedReleaseKey = import.meta.kunaiReleasePublicKey ?? "";

export const RELEASE_MANIFEST_NAMES = ["SHA256SUMS", "SHA256SUMS.archives"] as const;
export type ReleaseManifestName = (typeof RELEASE_MANIFEST_NAMES)[number];

export function releaseVerificationKey(spki: string) {
  const der = Buffer.from(spki, "base64");
  const key = createPublicKey({ key: der, type: "spki", format: "der" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    key.export({ type: "spki", format: "der" }).toString("base64") !== spki
  ) {
    throw new Error("Invalid Ed25519 release public key");
  }
  return key;
}

/**
 * The exact bytes a release signature covers (format `kunai-release-manifest v1`):
 *
 *     kunai-release-manifest v1\n
 *     version: <X.Y.Z>\n
 *     file: <SHA256SUMS | SHA256SUMS.archives>\n
 *     sha256: <64 lowercase hex of the manifest bytes>\n
 *
 * Verifiers never parse a signed document. They rebuild this statement from the
 * version they resolved, the manifest name they asked for and the bytes they
 * downloaded. A signature made for another release, another manifest, or any
 * other spelling (CRLF, extra spaces, a `v` prefix, a repeated line) does not
 * verify. install.sh and install.ps1 build the same bytes; keep all three in step.
 */
export function releaseManifestStatement(
  version: string,
  name: ReleaseManifestName,
  manifest: Uint8Array,
): string {
  if (parseCanonicalVersion(version) !== version) {
    throw new Error(`Release signature needs an exact X.Y.Z version, got ${version}`);
  }
  if (!RELEASE_MANIFEST_NAMES.includes(name)) {
    throw new Error(`Not a signed release manifest: ${name}`);
  }
  const digest = createHash("sha256").update(manifest).digest("hex");
  return `kunai-release-manifest v1\nversion: ${version}\nfile: ${name}\nsha256: ${digest}\n`;
}

export function verifyReleaseManifestSignature(input: {
  readonly version: string;
  readonly name: ReleaseManifestName;
  readonly manifest: Uint8Array;
  readonly signature: Uint8Array;
  readonly spki: string;
}): void {
  const statement = Buffer.from(
    releaseManifestStatement(input.version, input.name, input.manifest),
  );
  if (
    input.signature.length !== 64 ||
    !verify(null, statement, releaseVerificationKey(input.spki), input.signature)
  ) {
    throw new Error(`Invalid release checksum signature for ${input.name} of v${input.version}`);
  }
}
