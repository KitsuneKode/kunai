import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../../support/repo-scan";
import { inputExpansionsInRunBlocks } from "../../support/workflow-scan";

/**
 * Two workflow habits that hand control to whoever controls an input
 * (security review M5 and L2, #777):
 *
 * - downloading a moving `releases/latest/download/…` asset, which runs
 *   whatever upstream ships today with the job's credentials, and
 * - expanding `${{ inputs.* }}` or `${{ github.event.inputs.* }}` inside a
 *   `run:` script, where the value becomes shell source. Inputs must reach a
 *   script through `env:` and be validated there.
 */
const WORKFLOW_DIRS = [".github/workflows", ".github/actions"];

function workflowFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.ya?ml$/.test(entry.name)) files.push(rel);
    }
  };
  for (const dir of WORKFLOW_DIRS) walk(dir);
  return files.sort((a, b) => a.localeCompare(b));
}

describe("workflow supply chain", () => {
  test("no workflow downloads a moving `releases/latest` asset", () => {
    const offenders = workflowFiles().filter((file) =>
      /releases\/latest\/download\//.test(readFileSync(join(REPO_ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("no workflow expands an input inside a run script", () => {
    const offenders = workflowFiles().flatMap((file) =>
      inputExpansionsInRunBlocks(readFileSync(join(REPO_ROOT, file), "utf8")).map(
        (line) => `${file}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  test("the scanner flags block and one-line run scripts, and ignores env", () => {
    const yaml = [
      "      - name: a",
      "        env:",
      "          SAFE: ${{ inputs.version }}",
      "        run: |",
      '          x="${{ github.event.inputs.providers }}"',
      "      - name: b",
      "        run: echo ${{ inputs.tag }}",
      "      - name: c",
      "        with:",
      "          key: ${{ inputs.prefix }}",
    ].join("\n");
    expect(inputExpansionsInRunBlocks(yaml)).toEqual([5, 7]);
  });
});
