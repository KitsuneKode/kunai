import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type ReleaseNotesSection = {
  readonly title: string;
  readonly body: string;
  readonly items: readonly string[];
};

export type ReleaseNotesArtifact = {
  readonly schemaVersion: 1;
  readonly packageName: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly date: string | null;
  readonly summary: string;
  readonly sections: readonly ReleaseNotesSection[];
  readonly install: {
    readonly npm: string;
    readonly bunx: string;
    readonly binaryLatest: string;
  };
};

function repoRoot(): string {
  return resolve(process.cwd(), "../..");
}

function releaseDir(): string {
  return join(repoRoot(), ".release");
}

export function readReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[] {
  const dir = releaseDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as ReleaseNotesArtifact)
    .filter(
      (artifact) => artifact.schemaVersion === 1 && artifact.packageName === "@kitsunekode/kunai",
    );
}

export function latestReleaseNotesArtifact(): ReleaseNotesArtifact | null {
  return readReleaseNotesArtifacts()[0] ?? null;
}
