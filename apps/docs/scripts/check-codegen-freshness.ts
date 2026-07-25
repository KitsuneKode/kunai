import fs from "node:fs";
import path from "node:path";

import { buildMetadata, metadataIdentity } from "./sync-code-metadata";

const ROOT = path.resolve(import.meta.dir, "../../..");
const OUTPUT = path.join(ROOT, "apps/docs/lib/generated-metadata.json");

function main() {
  if (!fs.existsSync(OUTPUT)) {
    console.error("Missing generated-metadata.json — run: bun run --cwd apps/docs generate");
    process.exit(1);
  }

  const committed = JSON.parse(fs.readFileSync(OUTPUT, "utf-8")) as Record<string, unknown>;
  const fresh = buildMetadata();

  if (metadataIdentity(fresh) !== metadataIdentity(committed)) {
    console.error("generated-metadata.json is stale. Run:\n\n  bun run --cwd apps/docs generate\n");
    process.exit(1);
  }

  console.log("Codegen metadata is fresh.");
}

main();
