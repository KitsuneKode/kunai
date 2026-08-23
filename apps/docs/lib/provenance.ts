import provenanceJson from "./generated-provenance.json";

/**
 * When the generated metadata was last synced, and from which CLI revision.
 *
 * Deliberately separate from `generated-metadata.json` and gitignored. Both
 * values move on every regeneration and every commit while saying nothing about
 * whether the docs content changed, so committing them made any two branches
 * that both ran `generate` conflict on the same file — which happened on four
 * consecutive pull requests before this split.
 *
 * `bun run --cwd apps/docs generate` writes it, and that runs ahead of every
 * build (locally, in CI, and in the Vercel build command), so the file is always
 * present by the time anything imports it.
 */
export type Provenance = {
  readonly syncedAt: string;
  readonly cliSourceRevision: string;
};

export const provenance: Provenance = provenanceJson as Provenance;
