import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { collectSourceFiles, readRepoFile, REPO_ROOT } from "../../support/repo-scan";

/**
 * File-size ceilings for production source.
 *
 * The repo's oversized modules are its active debt: PlaybackPhase at ~4700
 * lines is where playback phases still get added because there is nowhere else
 * for them to go. A plain "no file over N" gate would fail today; a snapshot of
 * current sizes would ratchet nothing. So the gate is two-sided:
 *
 * - Any file not in the table must stay under the general ceiling — new giants
 *   are blocked at the gate.
 * - Tabled files get a named ceiling a little above their current size; growth
 *   past it fails, and so does drift *below* it by more than the stale margin —
 *   a split that shrinks a giant must lower the declared ceiling in the same
 *   change, or the table quietly re-licenses the debt it retired.
 */

/** Files above this line count need an explicit entry in the ceiling table. */
const GENERAL_CEILING_LINES = 1_600;

/**
 * How far a tabled file may shrink before its declared ceiling must come down
 * with it. Wide enough that real edits never trip it; narrow enough that a
 * landed split cannot leave the old ceiling standing.
 */
const STALE_CEILING_MARGIN_LINES = 250;

/**
 * Every file above the general ceiling, pinned near its current size.
 *
 * Baselines are headroom, not license: the number is "this file is known to be
 * this big today", chosen so routine edits fit and a real split must update the
 * table. Sizes at the audit-4 baseline are in the comment below.
 */
const FILE_SIZE_CEILINGS: Readonly<Record<string, number>> = {
  // audit-4 baseline: PlaybackPhase 4728, shell-workflows 3331,
  // miruro/direct 2651, videasy/direct 2604, browse-shell 2427,
  // root-overlay-shell 2343, DownloadService 2316, ink-shell 2275,
  // PersistentMpvSession 1790, allmanga/api-client 1721.
  "apps/cli/src/app/playback/PlaybackPhase.ts": 4_800,
  "apps/cli/src/app-shell/workflows/shell-workflows.ts": 3_400,
  "packages/providers/src/miruro/direct.ts": 2_750,
  "packages/providers/src/videasy/direct.ts": 2_700,
  "apps/cli/src/app-shell/browse-shell.tsx": 2_500,
  "apps/cli/src/app-shell/root-overlay-shell.tsx": 2_400,
  "apps/cli/src/services/download/DownloadService.ts": 2_400,
  "apps/cli/src/app-shell/ink-shell.tsx": 2_350,
  "apps/cli/src/infra/player/PersistentMpvSession.ts": 1_850,
  "packages/providers/src/allmanga/api-client.ts": 1_800,
};

const PRODUCTION_ROOTS = [
  "apps/cli/src",
  "apps/mobile/src",
  "apps/analytics-ingest/src",
  "apps/relay-server/src",
  "apps/docs",
  "packages/core/src",
  "packages/config/src",
  "packages/design/src",
  "packages/relay/src",
  "packages/schemas/src",
  "packages/storage/src",
  "packages/providers/src",
  "packages/types/src",
];

function lineCountOf(relativePath: string): number {
  return readRepoFile(relativePath).split("\n").length;
}

describe("source size ceilings", () => {
  const files = PRODUCTION_ROOTS.flatMap((root) =>
    collectSourceFiles(root, { skipDirs: ["experiments"] }),
  );

  test("no unlisted file exceeds the general ceiling", () => {
    const oversized = files
      .filter((file) => !(file in FILE_SIZE_CEILINGS))
      .flatMap((file) => {
        const lines = lineCountOf(file);
        return lines > GENERAL_CEILING_LINES
          ? [`${file}: ${lines} lines (ceiling ${GENERAL_CEILING_LINES})`]
          : [];
      });

    expect(
      oversized,
      "new oversized files need an explicit FILE_SIZE_CEILINGS entry — or better, a split",
    ).toEqual([]);
  });

  test("tabled files stay under their declared ceilings", () => {
    const blown = Object.entries(FILE_SIZE_CEILINGS).flatMap(([file, ceiling]) => {
      if (!existsSync(join(REPO_ROOT, file))) return [];
      const lines = lineCountOf(file);
      return lines > ceiling ? [`${file}: ${lines} lines (ceiling ${ceiling})`] : [];
    });

    expect(
      blown,
      "a known-giant file grew past its declared ceiling — raise it deliberately, with a reason",
    ).toEqual([]);
  });

  test("the ceiling table ratchets down instead of going stale", () => {
    const stale: string[] = [];
    for (const [file, ceiling] of Object.entries(FILE_SIZE_CEILINGS)) {
      if (!existsSync(join(REPO_ROOT, file))) {
        stale.push(`${file}: no longer exists — remove the entry`);
        continue;
      }
      const lines = lineCountOf(file);
      if (lines <= GENERAL_CEILING_LINES) {
        stale.push(`${file}: ${lines} lines, under the general ceiling — remove the entry`);
      } else if (ceiling - lines > STALE_CEILING_MARGIN_LINES) {
        stale.push(`${file}: ${lines} lines vs ceiling ${ceiling} — lower the ceiling`);
      }
    }

    expect(stale, "splits landed but the declared ceilings still license the old size").toEqual([]);
  });
});
