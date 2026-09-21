/**
 * Evidence bundle — verification output a human or agent can REVIEW, not just
 * an exit code. A bundle is `transcript.md` (narrated steps: keys → frame →
 * DB delta), `frames/NN-*.txt`, and `db/NN-*.json`. Agents that report having
 * verified must cite lines that exist in these artifacts — the harness can
 * re-check citations mechanically (`verifyCitations`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JournalEntry } from "./agent-driver";
import type { ProfileInspector } from "./profile-inspector";

export interface EvidenceBundle {
  readonly dir: string;
  readonly transcriptPath: string;
  readonly framePaths: readonly string[];
  readonly dbPath: string;
}

export function writeEvidenceBundle(input: {
  readonly dir: string;
  readonly journal: readonly JournalEntry[];
  readonly inspect: ProfileInspector;
  readonly notes?: readonly string[];
}): EvidenceBundle {
  const framesDir = join(input.dir, "frames");
  const dbDir = join(input.dir, "db");
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(dbDir, { recursive: true });

  const framePaths: string[] = [];
  const transcript: string[] = [
    `# Agent verification transcript`,
    "",
    `Steps: ${input.journal.length}`,
    "",
  ];

  for (const entry of input.journal) {
    const stepId = String(entry.step).padStart(2, "0");
    const framePath = join(framesDir, `${stepId}-${entry.kind}.txt`);
    writeFileSync(framePath, `${entry.frame}\n`, "utf8");
    framePaths.push(framePath);

    const dbPath = join(dbDir, `${stepId}-${entry.kind}.json`);
    writeFileSync(dbPath, `${JSON.stringify(entry.dbDelta, null, 2)}\n`, "utf8");

    transcript.push(`## ${stepId} · ${entry.kind} · ${entry.label}`, "");
    transcript.push("```", entry.frame, "```", "");
    const deltas = Object.entries(entry.dbDelta);
    if (deltas.length === 0) {
      transcript.push("_no db changes_", "");
    } else {
      for (const [table, d] of deltas) {
        transcript.push(`- \`${table}\`: +${d.added} −${d.removed}`);
      }
      transcript.push("");
    }
  }

  const config = input.inspect.config();
  transcript.push("## Final backend state", "", "```json");
  transcript.push(
    JSON.stringify(
      {
        config,
        tables: input.inspect.tables(),
        history: input.inspect.history(),
        queue: input.inspect.queue(),
      },
      null,
      2,
    ),
  );
  transcript.push("```", "");

  for (const note of input.notes ?? []) transcript.push(`> ${note}`, "");

  const transcriptPath = join(input.dir, "transcript.md");
  writeFileSync(transcriptPath, `${transcript.join("\n")}\n`, "utf8");

  return { dir: input.dir, transcriptPath, framePaths, dbPath: dbDir };
}

/**
 * Citation check — an agent's claim is only as good as what it can quote.
 * `verifyCitations` returns the citations that do NOT appear verbatim in any
 * captured frame or in the final-state JSON. An empty result means every claim
 * the agent made is backed by captured evidence.
 */
export function verifyCitations(input: {
  readonly bundle: EvidenceBundle;
  readonly citations: readonly string[];
}): { readonly unverified: readonly string[] } {
  const corpus: string[] = [];
  for (const framePath of input.bundle.framePaths) {
    corpus.push(readFileSync(framePath, "utf8"));
  }
  corpus.push(readFileSync(input.bundle.transcriptPath, "utf8"));

  const unverified = input.citations.filter((citation) => {
    const needle = citation.trim();
    if (needle.length === 0) return false;
    return !corpus.some((text) => text.includes(needle));
  });
  return { unverified };
}
