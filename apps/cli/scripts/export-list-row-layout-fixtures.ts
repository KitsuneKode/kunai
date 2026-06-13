import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildListRowLayoutFixtures } from "../src/app-shell/primitives/list-row-layout";

const outPath = join(
  import.meta.dir,
  "../../../.prototypes/_harness/list-row-layout-fixtures.json",
);

const payload = {
  schema: "kunai-list-row-layout-fixtures/v1",
  generatedAt: new Date().toISOString(),
  source: "apps/cli/src/app-shell/primitives/list-row-layout.ts",
  fixtures: buildListRowLayoutFixtures(),
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
