import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

/**
 * Signed-statement variants for the three release verifiers (updater,
 * install.sh, install.ps1). The statement is spelled out here by hand, on
 * purpose: it pins the signed bytes independently of the code under test.
 * Only `valid` may install; every other variant signs bytes a verifier must not
 * accept for (version, manifest) — another release, another manifest, or a
 * non-canonical spelling of the right one.
 */
export const SIGNED_STATEMENT_SCENARIOS = [
  "valid",
  "v1 signature at v2 URL",
  "raw manifest bytes",
  "other manifest name",
  "CRLF",
  "trailing whitespace",
  "duplicate version line",
  "v-prefixed version",
  "uppercase digest",
  "no final newline",
] as const;
export type SignedStatementScenario = (typeof SIGNED_STATEMENT_SCENARIOS)[number];

/** The version a rollback fixture claims the old signature belonged to. */
export const OLDER_RELEASE_VERSION = "1.2.2";

export function releaseSigningKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

export function signedStatementBytes(
  scenario: SignedStatementScenario,
  version: string,
  name: "SHA256SUMS" | "SHA256SUMS.archives",
  manifest: string | Uint8Array,
): Buffer {
  const digest = createHash("sha256").update(manifest).digest("hex");
  const other = name === "SHA256SUMS" ? "SHA256SUMS.archives" : "SHA256SUMS";
  const lines = (v: string, n: string, d: string) => [
    "kunai-release-manifest v1",
    `version: ${v}`,
    `file: ${n}`,
    `sha256: ${d}`,
  ];
  const lf = (parts: string[]) => parts.join("\n") + "\n";
  switch (scenario) {
    case "valid":
      return Buffer.from(lf(lines(version, name, digest)));
    case "v1 signature at v2 URL":
      return Buffer.from(lf(lines(OLDER_RELEASE_VERSION, name, digest)));
    case "raw manifest bytes":
      return Buffer.from(manifest);
    case "other manifest name":
      return Buffer.from(lf(lines(version, other, digest)));
    case "CRLF":
      return Buffer.from(lines(version, name, digest).join("\r\n") + "\r\n");
    case "trailing whitespace":
      return Buffer.from(lf(lines(version, name, digest).map((line) => line + " ")));
    case "duplicate version line": {
      const parts = lines(version, name, digest);
      parts.splice(1, 0, `version: ${OLDER_RELEASE_VERSION}`);
      return Buffer.from(lf(parts));
    }
    case "v-prefixed version":
      return Buffer.from(lf(lines("v" + version, name, digest)));
    case "uppercase digest":
      return Buffer.from(lf(lines(version, name, digest.toUpperCase())));
    case "no final newline":
      return Buffer.from(lines(version, name, digest).join("\n"));
  }
}

/** The statement variant a fixture scenario signs; non-statement scenarios sign `valid`. */
export function statementFor(scenario: string): SignedStatementScenario {
  return SIGNED_STATEMENT_SCENARIOS.find((candidate) => candidate === scenario) ?? "valid";
}

export function signStatement(
  privateKey: KeyObject,
  scenario: SignedStatementScenario,
  version: string,
  name: "SHA256SUMS" | "SHA256SUMS.archives",
  manifest: string | Uint8Array,
): Buffer {
  return sign(null, signedStatementBytes(scenario, version, name, manifest), privateKey);
}
