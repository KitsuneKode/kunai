import { createPublicKey, verify } from "node:crypto";

declare global {
  interface ImportMeta {
    readonly kunaiReleasePublicKey?: string;
  }
}

/** The release build inlines the pin. Source runs have no build metadata. */
export const embeddedReleaseKey = import.meta.kunaiReleasePublicKey ?? "";

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

export function verifyChecksumSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  spki: string,
): void {
  if (signature.length !== 64 || !verify(null, bytes, releaseVerificationKey(spki), signature)) {
    throw new Error("Invalid release checksum signature");
  }
}
