import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(import.meta.dir, "../../..");

function listDocContentFiles(docsRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
        files.push(fullPath);
      }
    }
  };
  walk(docsRoot);
  return files.sort();
}

function listProviderManifests(root: string): string[] {
  const providersDir = path.join(root, "packages/providers/src");
  if (!fs.existsSync(providersDir)) return [];
  return fs
    .readdirSync(providersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(providersDir, entry.name, "manifest.ts"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

export function resolveCliSourceRevision(root = DEFAULT_ROOT): string {
  const envCommit = process.env.SOURCE_COMMIT?.trim();
  if (envCommit) {
    return envCommit.slice(0, 12);
  }

  const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode === 0) {
    return new TextDecoder().decode(result.stdout).trim();
  }

  return "unknown";
}

export function computeCliSourceFingerprint(root = DEFAULT_ROOT): string {
  const hash = crypto.createHash("sha256");
  const cliFiles = [
    "apps/cli/src/container.ts",
    "apps/cli/src/container/bootstrap-providers.ts",
    "apps/cli/src/domain/session/command-registry.ts",
    "apps/cli/src/cli-args.ts",
  ];

  for (const rel of cliFiles) {
    const fullPath = path.join(root, rel);
    hash.update(rel);
    hash.update(fs.readFileSync(fullPath));
  }

  for (const manifestPath of listProviderManifests(root)) {
    const rel = path.relative(root, manifestPath);
    hash.update(rel);
    hash.update(fs.readFileSync(manifestPath));
  }

  return hash.digest("hex");
}

export function computeDocsContentFingerprint(root = DEFAULT_ROOT): string {
  const hash = crypto.createHash("sha256");
  const docsRoot = path.join(root, "docs");
  const featureStatusPath = path.join(root, "docs/feature-status.yaml");

  for (const filePath of listDocContentFiles(docsRoot)) {
    const rel = path.relative(root, filePath);
    hash.update(rel);
    hash.update(fs.readFileSync(filePath));
  }

  if (fs.existsSync(featureStatusPath)) {
    hash.update("docs/feature-status.yaml");
    hash.update(fs.readFileSync(featureStatusPath));
  }

  return hash.digest("hex");
}

export function computeFeatureStatusRevision(root = DEFAULT_ROOT): string {
  const featureStatusPath = path.join(root, "docs/feature-status.yaml");
  return crypto.createHash("sha256").update(fs.readFileSync(featureStatusPath)).digest("hex");
}
