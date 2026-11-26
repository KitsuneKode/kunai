#!/usr/bin/env bun
/**
 * One-time enrolment of Kunai's two signing keys, run by the maintainer on a
 * trusted machine:
 *
 * 1. the release checksum key (`KUNAI_CHECKSUM_SIGNING_KEY`): its public half is
 *    pinned in `apps/cli/src/services/update/release-key.json` and embedded in
 *    every native build, so updates and installers can verify `SHA256SUMS`;
 * 2. the provider hotfix manifest key: its public half is pinned in
 *    `apps/cli/src/services/providers/provider-manifest-pin.json`, which turns on
 *    the project's signed hotfix channel.
 *
 * Private keys never reach stdout or the checkout. Each is written once, mode
 * 0600, to a backup directory outside the repository and, unless
 * `--skip-secrets`, piped over stdin into the `release-production` environment
 * secrets with `gh`. The script refuses to replace a pinned key; rotation is a
 * deliberate edit, not a re-run. See RELEASING.md, "Enroll the release signing key".
 *
 *   bun scripts/setup-signing-keys.ts [--backup-dir <dir>] [--skip-secrets]
 */
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO = "KitsuneKode/kunai";
const SECRET_ENV = "release-production";
const RELEASE_PIN = "apps/cli/src/services/update/release-key.json";
const MANIFEST_PIN = "apps/cli/src/services/providers/provider-manifest-pin.json";

export type SigningMaterial = {
  readonly releasePrivatePem: string;
  readonly releaseSpki: string;
  readonly manifestKeyId: string;
  readonly manifestPrivatePem: string;
  readonly manifestPublicPem: string;
};

type ManifestPin = { url: string; publicKeysById: Record<string, string> };

export function generateSigningMaterial(now = new Date()): SigningMaterial {
  const release = generateKeyPairSync("ed25519");
  const manifest = generateKeyPairSync("ed25519");
  const month = now.toISOString().slice(0, 7).replace("-", "");
  return {
    releasePrivatePem: release.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    releaseSpki: release.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    manifestKeyId: `kunai-manifest-${month}`,
    manifestPrivatePem: manifest.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    manifestPublicPem: manifest.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Refuse before generating anything if either key is already pinned. */
export function assertNothingPinned(root: string): void {
  const release: { ed25519Spki?: string } = JSON.parse(
    readFileSync(join(root, RELEASE_PIN), "utf8"),
  );
  if (release.ed25519Spki?.trim()) {
    throw new Error(`${RELEASE_PIN} already pins a release key; rotate it deliberately instead.`);
  }
  const manifest: ManifestPin = JSON.parse(readFileSync(join(root, MANIFEST_PIN), "utf8"));
  if (Object.keys(manifest.publicKeysById).length > 0) {
    throw new Error(`${MANIFEST_PIN} already pins a manifest key; rotate it deliberately instead.`);
  }
}

/** Public halves only: these two files are what gets reviewed and committed. */
export function writePins(root: string, material: SigningMaterial): void {
  writeFileSync(
    join(root, RELEASE_PIN),
    `${JSON.stringify({ ed25519Spki: material.releaseSpki }, null, 2)}\n`,
  );
  const manifest: ManifestPin = JSON.parse(readFileSync(join(root, MANIFEST_PIN), "utf8"));
  manifest.publicKeysById = { [material.manifestKeyId]: material.manifestPublicPem };
  writeFileSync(join(root, MANIFEST_PIN), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Private halves: written once, owner-only, never over an existing file. */
export function writeBackups(dir: string, material: SigningMaterial): readonly string[] {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const files = [
    ["kunai-checksums.pem", material.releasePrivatePem],
    [`${material.manifestKeyId}.pem`, material.manifestPrivatePem],
  ] as const;
  return files.map(([name, pem]) => {
    const path = join(dir, name);
    writeFileSync(path, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return path;
  });
}

async function setSecret(name: string, value: string): Promise<void> {
  const proc = Bun.spawn(["gh", "secret", "set", name, "--repo", REPO, "--env", SECRET_ENV], {
    stdin: new TextEncoder().encode(value),
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`gh secret set ${name} failed: ${await new Response(proc.stderr).text()}`);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dir, "..");
  const chosen =
    argv.indexOf("--backup-dir") >= 0 ? argv[argv.indexOf("--backup-dir") + 1] : undefined;
  const stamp = new Date().toISOString().slice(0, 10);
  const backupDir = resolve(chosen ?? join(homedir(), `.kunai-signing-keys-${stamp}`));
  if (backupDir.startsWith(`${root}/`)) {
    throw new Error(
      "Refusing to keep private keys inside the checkout; pass --backup-dir elsewhere.",
    );
  }
  if (existsSync(backupDir) && chosen === undefined) {
    throw new Error(`${backupDir} already exists; pass --backup-dir to choose another place.`);
  }

  assertNothingPinned(root);
  const material = generateSigningMaterial();
  const backups = writeBackups(backupDir, material);
  if (!argv.includes("--skip-secrets")) {
    await setSecret("KUNAI_CHECKSUM_SIGNING_KEY", material.releasePrivatePem);
    await setSecret("KUNAI_PROVIDER_MANIFEST_SIGNING_KEY", material.manifestPrivatePem);
  }
  writePins(root, material);

  console.log(
    [
      "Signing keys enrolled.",
      "",
      `Private backups (0600, keep offline): ${backups.join(", ")}`,
      argv.includes("--skip-secrets")
        ? "GitHub secrets: skipped (--skip-secrets). Set them before the next release."
        : `GitHub secrets set in the ${SECRET_ENV} environment: KUNAI_CHECKSUM_SIGNING_KEY, KUNAI_PROVIDER_MANIFEST_SIGNING_KEY.`,
      `Public pins written: ${RELEASE_PIN}, ${MANIFEST_PIN} (key id ${material.manifestKeyId}).`,
      "",
      "Next: review and commit the two pin files, then create the hotfix channel once:",
      `  gh release create provider-manifest --repo ${REPO} --prerelease --title "Provider hotfix manifest" --notes "Signed provider hotfixes; not a Kunai release."`,
    ].join("\n"),
  );
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
