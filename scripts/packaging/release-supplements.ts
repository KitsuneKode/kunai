import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { verifyChecksumSignature } from "../../apps/cli/src/services/update/checksum-signature";
import pin from "../../apps/cli/src/services/update/release-key.json";
import { parseCanonicalVersion } from "../../apps/cli/src/services/update/version";
import {
  parseSumsFile,
  renderHomebrewFormula,
  renderPkgbuild,
  renderScoopManifest,
} from "./render-channels";
import { renderInstaller } from "./render-installers";

const manifests = ["SHA256SUMS", "SHA256SUMS.archives"] as const;
export const SUPPLEMENT_NAMES = [
  "SHA256SUMS.sig",
  "SHA256SUMS.archives.sig",
  "kunai.rb",
  "kunai.json",
  "PKGBUILD",
  "install.sh",
  "install.ps1",
];

export function releaseSupplements(input: {
  mode: "prepare" | "verify";
  version: string;
  native: string;
  directory: string;
  publicKey: string;
  privateKey?: string;
}): void {
  const { mode, native, directory, publicKey, version } = input;
  if (!publicKey) throw new Error("Missing pinned release public key");
  if (parseCanonicalVersion(version) !== version) throw new Error("Invalid release version");
  if (mode === "prepare") mkdirSync(directory, { recursive: true });
  for (const name of manifests) {
    const bytes = readFileSync(join(native, name));
    const path = join(directory, name + ".sig");
    if (mode === "prepare") {
      if (!input.privateKey) throw new Error("Missing protected checksum signing key");
      const signature = sign(null, bytes, createPrivateKey(input.privateKey));
      writeFileSync(path, signature);
    }
    verifyChecksumSignature(bytes, readFileSync(path), publicKey);
  }
  const channel = { version, tag: "v" + version };
  const sums = parseSumsFile(readFileSync(join(native, "SHA256SUMS.archives"), "utf8"));
  const licenseSha256 = createHash("sha256")
    .update(readFileSync(join(import.meta.dir, "../../LICENSE")))
    .digest("hex");
  for (const [name, expected] of Object.entries({
    "install.sh": renderInstaller("install.sh", publicKey),
    "install.ps1": renderInstaller("install.ps1", publicKey),
    "kunai.rb": renderHomebrewFormula(channel, sums),
    "kunai.json": renderScoopManifest(channel, sums),
    PKGBUILD: renderPkgbuild({ channel, sums, licenseSha256 }),
  })) {
    const path = join(directory, name);
    if (mode === "prepare") writeFileSync(path, expected);
    if (!readFileSync(path).equals(Buffer.from(expected)))
      throw new Error(`Release file differs from render: ${name}`);
  }
}

function main() {
  const [mode, version, native, directory] = process.argv.slice(2);
  if ((mode !== "prepare" && mode !== "verify") || !version || !native || !directory) {
    throw new Error("Expected prepare|verify <version> <native directory> <supplement directory>");
  }
  releaseSupplements({
    mode,
    version,
    native,
    directory,
    publicKey: pin.ed25519Spki,
    privateKey: process.env.KUNAI_CHECKSUM_SIGNING_KEY,
  });
}

if (import.meta.main) main();
