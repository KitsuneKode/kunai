import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../../../src/app-shell");

describe("diagnostics workflow routing", () => {
  test("palette, workflow, and overlay entry points share openDiagnosticsOverlay sources", () => {
    const palette = readFileSync(join(SRC, "dispatch-palette-command.ts"), "utf8");
    const workflow = readFileSync(join(SRC, "workflows/shell-workflows.ts"), "utf8");
    const overlay = readFileSync(join(SRC, "root-overlay-shell.tsx"), "utf8");

    expect(palette).toContain('openDiagnosticsOverlay(container, "diagnostics-palette")');
    expect(workflow).toContain('openDiagnosticsOverlay(container, "diagnostics-command")');
    expect(overlay).toContain('openDiagnosticsOverlay(container, "diagnostics-overlay-command")');
    expect(workflow).not.toContain('openStaticInfoShell({\n      title: "Diagnostics"');
  });
});
