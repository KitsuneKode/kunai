import fs from "node:fs";
import path from "node:path";

import { buildMetadata, metadataIdentity } from "./sync-code-metadata";
import {
  readGeneratedRepoContent,
  repoContentIdentity,
  repoContentOutputs,
  repoContentPath,
} from "./sync-repo-content";

const ROOT = path.resolve(import.meta.dir, "../../..");
const OUTPUT = path.join(ROOT, "apps/docs/lib/generated-metadata.json");
const REGENERATE = "bun run --cwd apps/docs generate";

function main() {
  if (!fs.existsSync(OUTPUT)) {
    console.error(`Missing generated-metadata.json — run: ${REGENERATE}`);
    process.exit(1);
  }

  const committed = JSON.parse(fs.readFileSync(OUTPUT, "utf-8")) as Record<string, unknown>;
  const fresh = buildMetadata();

  if (metadataIdentity(fresh) !== metadataIdentity(committed)) {
    console.error(`generated-metadata.json is stale. Run:\n\n  ${REGENERATE}\n`);
    process.exit(1);
  }

  // The runtime reads no files, so a stale bake is invisible until the site
  // ships the wrong releases or FAQ. Gate it here.
  for (const [fileName, payload] of Object.entries(repoContentOutputs())) {
    const existing = readGeneratedRepoContent(fileName);
    if (existing === null) {
      console.error(`Missing or unreadable ${repoContentPath(fileName)} — run: ${REGENERATE}`);
      process.exit(1);
    }
    if (repoContentIdentity(existing) !== repoContentIdentity(payload)) {
      console.error(`${fileName} is stale. Run:\n\n  ${REGENERATE}\n`);
      process.exit(1);
    }
  }

  console.log("Codegen metadata is fresh.");
}

main();
