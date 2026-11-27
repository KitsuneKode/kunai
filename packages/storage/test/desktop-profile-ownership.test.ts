import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkDesktopProfile, PROFILE_MARKER, PROFILE_MARKER_CONTENT } from "../src/paths";

/**
 * On-disk ownership checks behind `checkDesktopProfile` — the same contract
 * the CLI startup gate and both shell installers enforce. Each case gets a
 * throwaway root outside the test-sandbox profile and restores the inherited
 * override afterwards.
 */
describe("checkDesktopProfile ownership", () => {
  const saved = process.env.KUNAI_CONFIG_DIR;
  const roots: string[] = [];

  const freshRoot = () => {
    const parent = mkdtempSync(join(tmpdir(), "kunai-owner-test-"));
    roots.push(parent);
    return join(parent, "profile");
  };

  afterEach(() => {
    if (saved === undefined) delete process.env.KUNAI_CONFIG_DIR;
    else process.env.KUNAI_CONFIG_DIR = saved;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prepare claims an absent root with the ownership marker", () => {
    const root = freshRoot();
    process.env.KUNAI_CONFIG_DIR = root;

    checkDesktopProfile("prepare");

    const marker = join(root, PROFILE_MARKER);
    expect(readFileSync(marker, "utf8")).toBe(PROFILE_MARKER_CONTENT);
    // A second prepare on the now-owned root is a no-op.
    checkDesktopProfile("require");
  });

  test("inspect leaves an absent root unclaimed", () => {
    const root = freshRoot();
    process.env.KUNAI_CONFIG_DIR = root;

    checkDesktopProfile("inspect");

    expect(existsSync(root)).toBe(false);
  });

  test("require refuses an empty unmarked root", () => {
    const root = freshRoot();
    mkdirSync(root);
    process.env.KUNAI_CONFIG_DIR = root;

    expect(() => checkDesktopProfile("require")).toThrow("ownership marker");
    expect(existsSync(join(root, PROFILE_MARKER))).toBe(false);
  });

  test("a nonempty unmarked root is never adopted", () => {
    const root = freshRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "other-app.txt"), "not kunai");
    process.env.KUNAI_CONFIG_DIR = root;

    for (const mode of ["prepare", "inspect", "require"] as const) {
      expect(() => checkDesktopProfile(mode)).toThrow("ownership marker");
    }
    // The foreign content is untouched and no marker was planted.
    expect(readFileSync(join(root, "other-app.txt"), "utf8")).toBe("not kunai");
    expect(existsSync(join(root, PROFILE_MARKER))).toBe(false);
  });

  test("a wrong marker content does not count as ownership", () => {
    const root = freshRoot();
    mkdirSync(root);
    writeFileSync(join(root, PROFILE_MARKER), "kunai-profile-v0\n");
    process.env.KUNAI_CONFIG_DIR = root;

    expect(() => checkDesktopProfile("require")).toThrow("ownership marker");
  });

  test("expectedRoot pins the resolved profile", () => {
    const root = freshRoot();
    process.env.KUNAI_CONFIG_DIR = root;

    expect(() => checkDesktopProfile("inspect", join(root, "elsewhere"))).toThrow(
      "does not match expected profile root",
    );
    expect(() => checkDesktopProfile("inspect", root)).not.toThrow();
  });

  test("a file at the profile root is not a regular directory", () => {
    const root = freshRoot();
    writeFileSync(root, "not a dir");
    process.env.KUNAI_CONFIG_DIR = root;

    expect(() => checkDesktopProfile("prepare")).toThrow("regular directory");
  });

  test("a non-directory or symlink at a managed child is refused", () => {
    if (process.platform === "win32") return; // symlink creation needs elevation
    const root = freshRoot();
    mkdirSync(root);
    writeFileSync(join(root, "config"), "not a dir");
    process.env.KUNAI_CONFIG_DIR = root;
    expect(() => checkDesktopProfile("prepare")).toThrow("non-directory or symlink");

    const linked = freshRoot();
    mkdirSync(linked);
    symlinkSync("/etc", join(linked, "data"));
    process.env.KUNAI_CONFIG_DIR = linked;
    expect(() => checkDesktopProfile("prepare")).toThrow("non-directory or symlink");
  });

  test("a symlinked ancestor aliasing a default dir is refused", () => {
    if (process.platform === "win32") return;
    const parent = mkdtempSync(join(tmpdir(), "kunai-owner-alias-"));
    roots.push(parent);
    const real = join(parent, "xdg");
    const alias = join(parent, "alias");
    mkdirSync(real);
    symlinkSync(real, alias);

    const homeSaved = process.env.HOME;
    const xdgSaved = process.env.XDG_CONFIG_HOME;
    try {
      process.env.HOME = join(parent, "home");
      // The lexical override lives under the alias, not the default root —
      // only the physical comparison catches that they are the same dir.
      process.env.XDG_CONFIG_HOME = real;
      process.env.KUNAI_CONFIG_DIR = join(alias, "kunai");
      expect(() => checkDesktopProfile("prepare")).toThrow(
        "overlaps a platform-default Kunai directory",
      );
    } finally {
      if (homeSaved === undefined) delete process.env.HOME;
      else process.env.HOME = homeSaved;
      if (xdgSaved === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = xdgSaved;
    }
  });
});
