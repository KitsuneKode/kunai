import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { releaseVerificationKey } from "../../apps/cli/src/services/update/checksum-signature";
import pin from "../../apps/cli/src/services/update/release-key.json";

const ROOT = resolve(import.meta.dir, "../..");

export function renderInstaller(name: "install.sh" | "install.ps1", spki: string): string {
  if (spki) releaseVerificationKey(spki);
  const source = readFileSync(join(ROOT, name), "utf8");
  const marker =
    name === "install.sh" ? "readonly RELEASE_PUBLIC_KEY=''" : "$ReleasePublicKey = ''";
  if (source.split(marker).length !== 2)
    throw new Error(`Expected one public key marker in ${name}`);
  return source.replace(marker, marker.replace("''", `'${spki}'`));
}

if (import.meta.main) {
  const [directory, mode] = process.argv.slice(2);
  if (!directory) throw new Error("Expected installer output directory");
  // Keep the branded bootstrap usable until the first signed release is public.
  // The release smoke always exercises the key-pinned variant.
  const published =
    mode === "--website"
      ? JSON.parse(readFileSync(join(ROOT, ".release/kunai-v0.4.0.json"), "utf8")).status !==
        "staged"
      : true;
  if (published && !pin.ed25519Spki) throw new Error("Missing release signing key");
  mkdirSync(directory, { recursive: true });
  for (const name of ["install.sh", "install.ps1"] as const) {
    writeFileSync(join(directory, name), renderInstaller(name, published ? pin.ed25519Spki : ""));
  }
}
