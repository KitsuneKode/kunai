import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../../..");

describe("installer config destination", () => {
  test("install.sh does not write install.json via KUNAI_CONFIG_DIR", () => {
    const source = readFileSync(join(ROOT, "install.sh"), "utf8");
    expect(source).not.toContain("${KUNAI_CONFIG_DIR:-");
    expect(source).toContain("KUNAI_CONFIG_DIR is not a runtime override");
    expect(source).toContain("${XDG_CONFIG_HOME:-$HOME/.config}/kunai");
  });

  test("install.ps1 does not write install.json via KUNAI_CONFIG_DIR", () => {
    const source = readFileSync(join(ROOT, "install.ps1"), "utf8");
    expect(source).not.toContain("$env:KUNAI_CONFIG_DIR");
    expect(source).toContain("KUNAI_CONFIG_DIR is not a runtime override");
    expect(source).toContain("Join-Path $env:APPDATA 'kunai'");
  });
});
