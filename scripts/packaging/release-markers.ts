/**
 * The two marker assets every release carries: `install.marker` and
 * `update.marker`.
 *
 * Installers and the native updater fetch one after a successful install or a
 * verified update, so GitHub's per-asset download count splits installs from
 * updates. Kunai receives nothing. The bytes are fixed and version-free: a
 * marker is counted, never read.
 *
 * Kept apart from `release-supplements.ts` on purpose. Those are the signed
 * channel files that the metadata and package-channel jobs re-download and
 * re-verify for any tag, including tags published before markers existed.
 *
 *   bun scripts/packaging/release-markers.ts prepare <directory>
 *   bun scripts/packaging/release-markers.ts verify <directory>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  RELEASE_MARKER_NAMES,
  type ReleaseMarkerName,
} from "../../apps/cli/src/services/update/release-marker";

export { RELEASE_MARKER_NAMES };

export function releaseMarkerBody(name: ReleaseMarkerName): string {
  return `Kunai ${name}. GitHub counts downloads of this file; it holds no data and Kunai receives nothing.\n`;
}

export function releaseMarkers(mode: "prepare" | "verify", directory: string): void {
  if (mode === "prepare") mkdirSync(directory, { recursive: true });
  for (const name of RELEASE_MARKER_NAMES) {
    const path = join(directory, name);
    const expected = Buffer.from(releaseMarkerBody(name));
    if (mode === "prepare") writeFileSync(path, expected);
    if (!readFileSync(path).equals(expected)) {
      throw new Error(`Release marker differs from render: ${name}`);
    }
  }
}

if (import.meta.main) {
  const [mode, directory] = process.argv.slice(2);
  if ((mode !== "prepare" && mode !== "verify") || !directory) {
    throw new Error("Expected prepare|verify <directory>");
  }
  releaseMarkers(mode, directory);
}
