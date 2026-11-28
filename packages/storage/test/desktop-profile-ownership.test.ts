import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  checkDesktopProfile,
  DesktopProfileError,
  inferWindowsProfileFromExecutable,
  PROFILE_MARKER,
  PROFILE_MARKER_CONTENT,
} from "../src/paths";

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
    // The aliased dir must actually be a platform default on every supported
    // host: XDG on Linux, ~/Library/Application Support on macOS.
    const home = join(parent, "home");
    const real =
      process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : join(parent, "xdg");
    const alias = join(parent, "alias");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, alias);

    const homeSaved = process.env.HOME;
    const xdgSaved = process.env.XDG_CONFIG_HOME;
    try {
      process.env.HOME = home;
      // The lexical override lives under the alias, not the default root —
      // only the physical comparison catches that they are the same dir.
      process.env.XDG_CONFIG_HOME = real;
      const typed = join(alias, "kunai");
      process.env.KUNAI_CONFIG_DIR = typed;
      // The diagnostic names the spelling the user configured, not the
      // physical path it resolves to.
      expect(() => checkDesktopProfile("prepare")).toThrow(`KUNAI_CONFIG_DIR="${typed}"`);
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

/**
 * Windows-only profile inference: a payload running out of an owned profile's
 * version store resolves that profile without an override. Everything here is
 * a throwaway root under the temp dir — nothing touches a live profile.
 */
describe.skipIf(process.platform !== "win32")("inferWindowsProfileFromExecutable", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  const makeEnv = (home: string): NodeJS.ProcessEnv => ({
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "appdata"),
    LOCALAPPDATA: join(home, "localappdata"),
  });

  const makeFixture = (profileName = "profile") => {
    const parent = mkdtempSync(join(tmpdir(), "kunai-infer-"));
    roots.push(parent);
    const profile = join(parent, profileName);
    const exe = join(profile, "data", "versions", "1.2.3", "kunai.exe");
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "MZ placeholder\n");
    writeFileSync(join(profile, PROFILE_MARKER), PROFILE_MARKER_CONTENT);
    return { parent, profile, exe, env: makeEnv(parent) };
  };

  test("infers the canonical profile root from an owned versioned executable", () => {
    const { profile, exe, env } = makeFixture();
    expect(inferWindowsProfileFromExecutable(exe, env)).toBe(realpathSync.native(profile));
    expect(env.KUNAI_CONFIG_DIR).toBeUndefined();
  });

  test("refuses an unmarked root and creates nothing", () => {
    const { profile, exe, env } = makeFixture();
    rmSync(join(profile, PROFILE_MARKER));
    expect(() => inferWindowsProfileFromExecutable(exe, env)).toThrow(DesktopProfileError);
    expect(existsSync(join(profile, PROFILE_MARKER))).toBe(false);
  });

  test("refuses a marker with different bytes", () => {
    const { profile, exe, env } = makeFixture();
    writeFileSync(join(profile, PROFILE_MARKER), "not-the-marker\n");
    expect(() => inferWindowsProfileFromExecutable(exe, env)).toThrow(DesktopProfileError);
  });

  test("refuses a marker that is a junction, not a file", () => {
    const { parent, profile, exe, env } = makeFixture();
    const target = join(parent, "marker-target");
    mkdirSync(target, { recursive: true });
    rmSync(join(profile, PROFILE_MARKER));
    symlinkSync(target, join(profile, PROFILE_MARKER), "junction");
    expect(() => inferWindowsProfileFromExecutable(exe, env)).toThrow(DesktopProfileError);
  });

  test("refuses a junctioned versions directory", () => {
    const { parent, profile, exe, env } = makeFixture();
    const versions = join(profile, "data", "versions");
    const target = join(parent, "versions-target");
    renameSync(versions, target);
    symlinkSync(target, versions, "junction");
    expect(() => inferWindowsProfileFromExecutable(exe, env)).toThrow(DesktopProfileError);
  });

  test("an executable outside a version store returns undefined", () => {
    const { parent, env } = makeFixture();
    const exe = join(parent, "elsewhere", "kunai.exe");
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "MZ placeholder\n");
    expect(inferWindowsProfileFromExecutable(exe, env)).toBeUndefined();
  });

  test.each(["", "C:\\elsewhere", "rel/path"])(
    "an explicit override value (%j) bypasses inference entirely",
    (value) => {
      const { profile, exe, env } = makeFixture();
      env.KUNAI_CONFIG_DIR = value;
      rmSync(join(profile, PROFILE_MARKER));
      expect(inferWindowsProfileFromExecutable(exe, env)).toBeUndefined();
    },
  );

  test("a hazardous profile root is refused even with a valid marker", () => {
    // The profile root contains the fake APPDATA\kunai default dir — lexical
    // overlap is refused before anything could be written.
    const parent = mkdtempSync(join(tmpdir(), "kunai-infer-"));
    roots.push(parent);
    const env = makeEnv(parent);
    const profile = join(parent, "appdata");
    const exe = join(profile, "data", "versions", "1.2.3", "kunai.exe");
    mkdirSync(join(env.APPDATA!, "kunai"), { recursive: true });
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "MZ placeholder\n");
    writeFileSync(join(profile, PROFILE_MARKER), PROFILE_MARKER_CONTENT);
    expect(() => inferWindowsProfileFromExecutable(exe, env)).toThrow(
      "overlaps a platform-default Kunai directory",
    );
  });
});
