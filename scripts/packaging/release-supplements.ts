import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  RELEASE_MANIFEST_NAMES,
  releaseManifestStatement,
  verifyReleaseManifestSignature,
} from "../../apps/cli/src/services/update/checksum-signature";
import pin from "../../apps/cli/src/services/update/release-key.json";
import { parseCanonicalVersion } from "../../apps/cli/src/services/update/version";
import {
  parseSumsFile,
  renderHomebrewFormula,
  renderPkgbuild,
  renderScoopManifest,
} from "./render-channels";
import { renderInstaller } from "./render-installers";

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
  // Each signature covers the version-bound statement (format in RELEASING.md),
  // so a signed set from one release never verifies at another release's tag.
  for (const name of RELEASE_MANIFEST_NAMES) {
    const manifest = readFileSync(join(native, name));
    const path = join(directory, name + ".sig");
    if (mode === "prepare") {
      if (!input.privateKey) throw new Error("Missing protected checksum signing key");
      const statement = Buffer.from(releaseManifestStatement(version, name, manifest));
      writeFileSync(path, sign(null, statement, createPrivateKey(input.privateKey)));
    }
    verifyReleaseManifestSignature({
      version,
      name,
      manifest,
      signature: readFileSync(path),
      spki: publicKey,
    });
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
