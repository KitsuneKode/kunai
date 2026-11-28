import { describe, expect, test } from "bun:test";
import { win32 as win32Path } from "node:path";

import {
  classifyWindowsExecutableProfile,
  PROFILE_MARKER,
  PROFILE_MARKER_CONTENT,
  type WindowsProfileFs,
  type WindowsProfileInference,
} from "../src/paths";

type VirtualEntry =
  | { readonly kind: "file"; readonly content: string }
  | { readonly kind: "directory" }
  | { readonly kind: "symlink"; readonly target: string };

function normalizeWindowsPath(path: string): string {
  return win32Path.normalize(path).replaceAll("/", "\\");
}

function pathKey(path: string): string {
  return normalizeWindowsPath(path).toLowerCase();
}

/** Minimal case-insensitive Windows file tree; symlink resolution is enough for realpathNative. */
class VirtualWindowsFs implements WindowsProfileFs {
  private readonly entries = new Map<string, VirtualEntry>();

  constructor() {
    this.addDirectory("C:\\");
  }

  addDirectory(path: string): this {
    const chain: string[] = [];
    let current = normalizeWindowsPath(path);
    for (;;) {
      chain.unshift(current);
      const parent = win32Path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const directory of chain) {
      if (!this.entries.has(pathKey(directory))) {
        this.entries.set(pathKey(directory), { kind: "directory" });
      }
    }
    return this;
  }

  addFile(path: string, content: string): this {
    this.addDirectory(win32Path.dirname(path));
    this.entries.set(pathKey(path), { kind: "file", content });
    return this;
  }

  addSymlink(path: string, target: string): this {
    this.addDirectory(win32Path.dirname(path));
    this.entries.set(pathKey(path), { kind: "symlink", target });
    return this;
  }

  lstat(path: string) {
    const entry = this.entries.get(pathKey(path));
    if (!entry) return undefined;
    return {
      isFile: () => entry.kind === "file",
      isDirectory: () => entry.kind === "directory",
      isSymbolicLink: () => entry.kind === "symlink",
    };
  }

  realpathNative(path: string): string {
    const resolved = this.resolve(path);
    if (!this.entries.has(pathKey(resolved))) {
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
    }
    return resolved;
  }

  readFileUtf8(path: string, maxBytes: number): string {
    const resolved = this.realpathNative(path);
    const entry = this.entries.get(pathKey(resolved));
    if (!entry || entry.kind !== "file") {
      throw new Error(`ENOENT: not a regular file, open '${path}'`);
    }
    if (Buffer.byteLength(entry.content, "utf8") > maxBytes) {
      throw new Error(`file exceeds ${maxBytes} bytes`);
    }
    return entry.content;
  }

  private resolve(path: string, seen = new Set<string>()): string {
    const normalized = normalizeWindowsPath(path);
    const parsed = win32Path.parse(normalized);
    if (!parsed.root) throw new Error(`path is not absolute: ${path}`);
    const segments = normalized
      .slice(parsed.root.length)
      .split(/[\\/]+/)
      .filter(Boolean);
    let current = parsed.root;
    for (const [index, segment] of segments.entries()) {
      current = win32Path.join(current, segment);
      const entry = this.entries.get(pathKey(current));
      if (!entry) throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
      if (entry.kind !== "symlink") continue;
      const key = pathKey(current);
      if (seen.has(key)) throw new Error(`ELOOP: too many symbolic links, realpath '${path}'`);
      seen.add(key);
      const target = win32Path.isAbsolute(entry.target)
        ? entry.target
        : win32Path.join(win32Path.dirname(current), entry.target);
      return this.resolve(win32Path.join(target, ...segments.slice(index + 1)), seen);
    }
    return normalized;
  }
}

const HOME = "C:\\Users\\k";
const APPDATA = win32Path.join(HOME, "AppData", "Roaming");
const LOCALAPPDATA = win32Path.join(HOME, "AppData", "Local");
const MANIFEST_PATH = win32Path.join(APPDATA, "kunai", "install.json");

function makeEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    USERPROFILE: HOME,
    APPDATA,
    LOCALAPPDATA,
    ...overrides,
  };
}

function addVersionedExecutable(fs: VirtualWindowsFs, root: string, version = "1.2.3"): string {
  const executable = win32Path.join(root, "data", "versions", version, "kunai.exe");
  fs.addFile(executable, "MZ placeholder\n");
  return executable;
}

function addManifest(fs: VirtualWindowsFs, manifest: object | string): string {
  fs.addFile(
    MANIFEST_PATH,
    typeof manifest === "string" ? manifest : `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return MANIFEST_PATH;
}

function classify(
  executablePath: string,
  fs: VirtualWindowsFs,
  env: Readonly<Record<string, string | undefined>> = makeEnv(),
  platform: NodeJS.Platform = "win32",
): WindowsProfileInference {
  return classifyWindowsExecutableProfile({ executablePath, platform, env, fs });
}

function expectAmbiguous(result: WindowsProfileInference, fragments: readonly string[]): void {
  expect(result.kind).toBe("ambiguous");
  if (result.kind !== "ambiguous") return;
  for (const fragment of fragments) {
    expect(result.error.message).toContain(fragment);
  }
}

describe("classifyWindowsExecutableProfile", () => {
  test("returns non-win32 outside Windows without inspecting the filesystem", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    expect(classify(executable, fs, makeEnv(), "linux")).toEqual({
      kind: "none",
      reason: "non-win32",
    });
  });

  test.each(["", "C:\\elsewhere"])(
    "an explicit KUNAI_CONFIG_DIR value (%j) takes precedence",
    (value) => {
      const fs = new VirtualWindowsFs();
      const root = "C:\\profiles\\personal";
      const executable = addVersionedExecutable(fs, root);
      fs.addFile(win32Path.join(root, PROFILE_MARKER), PROFILE_MARKER_CONTENT);
      expect(classify(executable, fs, makeEnv({ KUNAI_CONFIG_DIR: value }))).toEqual({
        kind: "none",
        reason: "env-override",
      });
    },
  );

  test("returns non-matching-path outside a data versions kunai.exe layout", () => {
    const fs = new VirtualWindowsFs();
    const executable = win32Path.join("C:\\tools\\kunai", "versions", "1.2.3", "kunai.exe");
    fs.addFile(executable, "MZ placeholder\n");
    expect(classify(executable, fs)).toEqual({ kind: "none", reason: "non-matching-path" });
  });

  test("rejects a non-canonical version directory as non-matching-path", () => {
    const fs = new VirtualWindowsFs();
    const executable = win32Path.join(
      "C:\\tools\\kunai",
      "data",
      "versions",
      "1.2.3-beta",
      "kunai.exe",
    );
    fs.addFile(executable, "MZ placeholder\n");
    expect(classify(executable, fs)).toEqual({ kind: "none", reason: "non-matching-path" });
  });

  test("classifies an owned profile payload as profile and returns its physical root", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\profiles\\personal";
    const executable = addVersionedExecutable(fs, root);
    fs.addFile(win32Path.join(root, PROFILE_MARKER), PROFILE_MARKER_CONTENT);

    expect(classify(executable, fs)).toEqual({ kind: "profile", profileDir: root });
  });

  test("classifies the issue #864 data-leaf install as normal-install from an exact manifest match", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const executable = addVersionedExecutable(fs, root);
    const manifestPath = addManifest(fs, {
      schemaVersion: 2,
      method: "binary",
      activeVersion: "1.2.3",
      launcherPath: "C:\\tools\\kunai\\bin\\kunai.exe",
      versionedPath: executable,
    });

    expect(classify(executable, fs)).toEqual({ kind: "normal-install", manifestPath });
  });

  test("matches drive letters case-insensitively", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    addManifest(fs, { schemaVersion: 2, method: "binary", versionedPath: executable });

    const result = classify(executable.replace(/^C:/, "c:"), fs);
    expect(result).toEqual({ kind: "normal-install", manifestPath: MANIFEST_PATH });
  });

  test("matches a schema-1 versionPath", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    addManifest(fs, {
      channel: "binary",
      method: "binary",
      version: "1.2.3",
      versionPath: executable,
    });

    expect(classify(executable, fs)).toEqual({
      kind: "normal-install",
      manifestPath: MANIFEST_PATH,
    });
  });

  test("matches a sibling version in the same physical versions directory during upgrade smoke", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const oldExecutable = addVersionedExecutable(fs, root, "1.2.3");
    const newExecutable = addVersionedExecutable(fs, root, "1.2.4");
    addManifest(fs, { schemaVersion: 2, method: "binary", versionedPath: oldExecutable });

    expect(classify(newExecutable, fs)).toEqual({
      kind: "normal-install",
      manifestPath: MANIFEST_PATH,
    });
  });

  test("a fresh install with no marker and no manifest is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");

    expectAmbiguous(classify(executable, fs), [
      PROFILE_MARKER,
      "install.json",
      "KUNAI_CONFIG_DIR",
      "reinstall",
    ]);
  });

  test("a symlinked marker is ambiguous and never falls through to the manifest", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const executable = addVersionedExecutable(fs, root);
    const target = win32Path.join(root, "marker-target");
    fs.addFile(target, PROFILE_MARKER_CONTENT);
    fs.addSymlink(win32Path.join(root, PROFILE_MARKER), target);
    addManifest(fs, { schemaVersion: 2, method: "binary", versionedPath: executable });

    expectAmbiguous(classify(executable, fs), [PROFILE_MARKER, "not a regular file"]);
  });

  test("a BOM-prefixed marker is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const executable = addVersionedExecutable(fs, root);
    fs.addFile(win32Path.join(root, PROFILE_MARKER), `\ufeff${PROFILE_MARKER_CONTENT}`);

    expectAmbiguous(classify(executable, fs), [PROFILE_MARKER, "bytes"]);
  });

  test("a marker that is a directory is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const executable = addVersionedExecutable(fs, root);
    fs.addDirectory(win32Path.join(root, PROFILE_MARKER));

    expectAmbiguous(classify(executable, fs), [PROFILE_MARKER, "not a regular file"]);
  });

  test("a symlinked versions directory is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const realVersions = win32Path.join(root, "real-versions");
    const executable = win32Path.join(realVersions, "1.2.3", "kunai.exe");
    fs.addFile(executable, "MZ placeholder\n");
    fs.addSymlink(win32Path.join(root, "data", "versions"), realVersions);

    expectAmbiguous(classify(win32Path.join(root, "data", "versions", "1.2.3", "kunai.exe"), fs), [
      "versions",
      "symlink",
    ]);
  });

  test("a symlinked executable is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const root = "C:\\tools\\kunai";
    const executable = win32Path.join(root, "data", "versions", "1.2.3", "kunai.exe");
    const target = win32Path.join(root, "payload.exe");
    fs.addFile(target, "MZ placeholder\n");
    fs.addDirectory(win32Path.dirname(executable));
    fs.addSymlink(executable, target);

    expectAmbiguous(classify(executable, fs), ["kunai.exe", "symlink"]);
  });

  test("a symlinked install.json is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    const target = win32Path.join(APPDATA, "kunai", "manifest-target.json");
    fs.addFile(target, JSON.stringify({ method: "binary", versionedPath: executable }));
    fs.addSymlink(MANIFEST_PATH, target);

    expectAmbiguous(classify(executable, fs), ["install.json", "not a regular file"]);
  });

  test("an oversized install.json is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    addManifest(fs, `{"method":"binary","padding":"${"x".repeat(64 * 1024)}"}`);

    expectAmbiguous(classify(executable, fs), ["install.json", "64 KiB"]);
  });

  test("invalid JSON in install.json is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    addManifest(fs, "{not json");

    expectAmbiguous(classify(executable, fs), ["install.json", "valid JSON"]);
  });

  test("a non-binary install.json is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    addManifest(fs, { schemaVersion: 2, method: "npm-global", versionedPath: executable });

    expectAmbiguous(classify(executable, fs), ["install.json", "binary"]);
  });

  test("a manifest pointing at another executable is ambiguous", () => {
    const fs = new VirtualWindowsFs();
    const executable = addVersionedExecutable(fs, "C:\\tools\\kunai");
    const other = addVersionedExecutable(fs, "C:\\other\\kunai");
    addManifest(fs, { schemaVersion: 2, method: "binary", versionedPath: other });

    expectAmbiguous(classify(executable, fs), ["does not name this executable"]);
  });
});
