import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { storageRootEnv } from "../helpers/storage-env";
import {
  createIsolatedCliProfile,
  disposeIsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import { bootSurface } from "./frame-match";
import { startTmuxSession, tmuxSessionStatePath } from "./tmux-session";

const CLI_ROOT = resolve(import.meta.dirname, "../..");
function itTmux(name: string, run: () => Promise<void>) {
  const test = Bun.which("tmux") ? it : it.skip;
  test(name, run);
}

async function cli(...args: string[]) {
  const proc = Bun.spawn([process.execPath, "test/agent/session.ts", ...args], {
    cwd: CLI_ROOT,
    env: { ...process.env, KUNAI_CREDENTIAL_BACKEND: "file" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

describe("held session CLI", () => {
  itTmux("accepts flag-shaped app arguments and proves the offline surface healthy", async () => {
    const name = `cli-offline-${process.pid}`;
    const reportDir = mkdtempSync(join(tmpdir(), "kunai-session-cli-proof-"));
    try {
      const started = await cli("start", "--name", name, "--command", "--offline");
      expect(started.err).not.toContain("unknown flag");
      expect(started.code).toBe(0);
      const health = await cli("doctor", "--name", name);
      expect(health.code).toBe(0);
      expect(health.out).toContain("Library");
      expect(health.out).toContain("file");
      expect((await cli("report", reportDir, "--name", name)).code).toBe(0);
      expect((await cli("stop", "--name", name)).code).toBe(0);
      expect(existsSync(tmuxSessionStatePath(name))).toBe(false);
      expect(readFileSync(join(reportDir, "frame.txt"), "utf8")).toContain("Library");
    } finally {
      await cli("stop", "--name", name);
      rmSync(reportDir, { recursive: true, force: true });
    }
  });

  it("rejects a missing flag value before creating a session", async () => {
    const result = await cli("start", "--name", `missing-value-${process.pid}`, "--command");
    expect(result.code).toBe(2);
    expect(result.err).toContain("missing value");
  });

  it("does not let a boolean flag swallow an unknown flag", async () => {
    const result = await cli("start", "--keep-profile", "--typo");
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown flag: --typo");
  });

  it("rejects malformed nested sidecar fields before attaching", async () => {
    const name = `invalid-sidecar-${process.pid}`;
    const profile = createIsolatedCliProfile(name);
    const statePath = tmuxSessionStatePath(name);
    try {
      writeFileSync(
        statePath,
        JSON.stringify({
          name,
          profile: { ...profile, paths: { ...profile.paths, dataDbPath: 42 } },
          runScript: join(profile.rootDir, "run.sh"),
          startedAt: "test",
          keepProfile: true,
        }),
      );
      const result = await cli("inspect", "tables", "--name", name);
      expect(result.code).toBe(1);
      expect(result.err).toContain("corrupt session sidecar");
      expect(existsSync(statePath)).toBe(true);
      expect(existsSync(profile.rootDir)).toBe(true);
    } finally {
      rmSync(statePath, { force: true });
      disposeIsolatedCliProfile(profile);
    }
  });

  itTmux(
    "does not retain a sidecar or profile when the app exits before becoming interactive",
    async () => {
      const name = `exit-before-ready-${process.pid}`;
      const before = readdirSync(tmpdir()).filter((d) =>
        d.startsWith(`kunai-integration-${name}-`),
      );
      const result = await cli("start", "--name", name, "--command", "--version");
      expect(result.code).toBe(1);
      expect(existsSync(tmuxSessionStatePath(name))).toBe(false);
      expect(
        readdirSync(tmpdir()).filter((d) => d.startsWith(`kunai-integration-${name}-`)),
      ).toEqual(before);
      // Diagnostics outside the deleted sandbox belong to this test too.
      for (const dir of readdirSync(tmpdir()).filter((d) =>
        d.startsWith(`kunai-start-failure-${name}-`),
      )) {
        expect(readFileSync(join(tmpdir(), dir, "frame.txt"), "utf8")).toContain("kunai ");
        rmSync(join(tmpdir(), dir), { recursive: true, force: true });
      }
    },
  );

  itTmux(
    "stops a retained custom profile but refuses to delete it before killing the session",
    async () => {
      const name = `custom-stop-${process.pid}`;
      const owner = createIsolatedCliProfile(name);
      const rootDir = join(owner.rootDir, "caller-owned");
      const env = storageRootEnv(rootDir);
      const paths = getKunaiPaths({ homeDir: rootDir, env });
      for (const dir of [paths.configDir, paths.dataDir, paths.cacheDir])
        mkdirSync(dir, { recursive: true });
      const profile = {
        rootDir,
        env,
        paths,
        configHome: paths.configDir,
        dataHome: paths.dataDir,
        cacheHome: paths.cacheDir,
      };
      const s = await startTmuxSession({ name, profile, command: "--offline", keepProfile: true });
      const statePath = tmuxSessionStatePath(name);
      const state = {
        name,
        profile,
        runScript: join(rootDir, "run.sh"),
        startedAt: "test",
        keepProfile: false,
      };
      try {
        await s.waitFor((frame) => bootSurface(frame) === "Library", "offline custom profile");
        writeFileSync(statePath, JSON.stringify(state));
        const refused = await cli("stop", "--name", name);
        expect(refused.code).toBe(1);
        expect(refused.err).toContain("refusing to delete unexpected profile dir");
        expect((await cli("doctor", "--name", name)).code).toBe(0);
        writeFileSync(statePath, JSON.stringify({ ...state, keepProfile: true }));
        expect((await cli("stop", "--name", name)).code).toBe(0);
        expect(existsSync(statePath)).toBe(false);
        expect(existsSync(profile.paths.configPath)).toBe(true);
      } finally {
        await s.stop();
        rmSync(statePath, { force: true });
        disposeIsolatedCliProfile(owner);
      }
    },
  );

  it("refuses a sidecar selecting native credentials without launching or reading a vault", async () => {
    const name = `doctor-vault-${process.pid}`;
    const profile = createIsolatedCliProfile(name);
    const statePath = tmuxSessionStatePath(name);
    try {
      writeFileSync(
        statePath,
        JSON.stringify({
          name,
          profile: { ...profile, env: { ...profile.env, KUNAI_CREDENTIAL_BACKEND: "keychain" } },
          runScript: join(profile.rootDir, "run.sh"),
          startedAt: "test",
          keepProfile: true,
        }),
      );
      const result = await cli("doctor", "--name", name);
      expect(result.code).toBe(1);
      expect(result.err).toContain("credential backend must be file");
      expect(existsSync(statePath)).toBe(true);
    } finally {
      rmSync(statePath, { force: true });
      disposeIsolatedCliProfile(profile);
    }
  });

  it("refuses an inspector path outside the profile before reading it", async () => {
    const name = `doctor-path-${process.pid}`;
    const profile = createIsolatedCliProfile(name);
    const foreign = mkdtempSync(join(tmpdir(), "kunai-foreign-proof-"));
    const configPath = join(foreign, "config.json");
    const statePath = tmuxSessionStatePath(name);
    try {
      writeFileSync(configPath, "invalid JSON: must never be read");
      writeFileSync(
        statePath,
        JSON.stringify({
          name,
          profile: { ...profile, paths: { ...profile.paths, configPath } },
          runScript: join(profile.rootDir, "run.sh"),
          startedAt: "test",
          keepProfile: true,
        }),
      );
      const result = await cli("inspect", "config", "--name", name);
      expect(result.code).toBe(1);
      expect(result.err).toContain("inspector path escapes");
      expect(readFileSync(configPath, "utf8")).toBe("invalid JSON: must never be read");
    } finally {
      rmSync(statePath, { force: true });
      disposeIsolatedCliProfile(profile);
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  it("refuses to delete another session's temporary profile", async () => {
    const name = `stop-owner-${crypto.randomUUID()}`;
    const profile = createIsolatedCliProfile(`other-owner-${process.pid}`);
    const statePath = tmuxSessionStatePath(name);
    try {
      writeFileSync(profile.paths.configPath, "{}");
      writeFileSync(
        statePath,
        JSON.stringify({
          name,
          profile,
          runScript: join(profile.rootDir, "run.sh"),
          startedAt: "test",
          keepProfile: false,
        }),
      );
      const result = await cli("stop", "--name", name);
      expect(result.code).toBe(1);
      expect(result.err).toContain("refusing to delete unexpected profile dir");
      expect(existsSync(profile.paths.configPath)).toBe(true);
      expect(existsSync(statePath)).toBe(true);
    } finally {
      rmSync(statePath, { force: true });
      disposeIsolatedCliProfile(profile);
    }
  });
});
