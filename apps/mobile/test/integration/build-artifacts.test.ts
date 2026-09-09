import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findForbiddenIosOutputTokens,
  MOBILE_TARGETS,
  type MobileBuildMetadata,
  waitForMobileHostProof,
} from "../../scripts/build-contract";
import { isPosixHost } from "../support/platform-gates";

const MOBILE_ROOT = join(import.meta.dir, "../..");
const DIST = join(MOBILE_ROOT, "dist");
// Bun can intentionally masquerade as `node` inside a nested package script.
// Pin the real Node executable that Bun exposes to lifecycle scripts so this
// suite qualifies the runtime shipped to Termux rather than Bun compatibility.
const NODE_RUNTIME = process.env.NODE ?? "node";
// SAFETY: The build script writes this generated manifest from a MobileBuildMetadata value,
// and the tests below independently verify its complete target and artifact fields.
const BUILD_METADATA = JSON.parse(
  readFileSync(join(DIST, "mobile-build-meta.json"), "utf8"),
) as MobileBuildMetadata;

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

describe("mobile build artifacts", () => {
  test("declares the exact target and artifact manifest", () => {
    expect(BUILD_METADATA.schemaVersion).toBe(2);
    expect(BUILD_METADATA.targets.map((target) => target.id)).toEqual(
      MOBILE_TARGETS.map((target) => target.id),
    );
    expect(BUILD_METADATA.artifacts.map((artifact) => artifact.path)).toEqual([
      "android/kunai-mobile-android.mjs",
      "ios/kunai-mobile",
      "ios/kunai-mobile-http",
      "ios/kunai-mobile-ios.js",
      "ios/kunai-mobile-open-vlc",
      "ios/kunai-mobile-read-line",
    ]);
    expect(BUILD_METADATA.artifactSets.map((artifactSet) => artifactSet.target)).toEqual([
      "android-termux-node",
      "ios-ashell",
    ]);
    for (const artifactSet of BUILD_METADATA.artifactSets) {
      const members = BUILD_METADATA.artifacts
        .filter((artifact) => artifactSet.artifacts.includes(artifact.path))
        .map((artifact) => [artifact.path, artifact.sha256] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      expect(artifactSet.artifacts).toEqual(members.map(([path]) => path));
      expect(artifactSet.sha256).toBe(sha256(Buffer.from(JSON.stringify(members))));
    }
  });

  for (const artifact of BUILD_METADATA.artifacts) {
    test(`matches checksum, size, and mode for ${artifact.path}`, () => {
      const path = join(DIST, artifact.path);
      const bytes = readFileSync(path);
      expect(artifact.bytes).toBe(bytes.byteLength);
      expect(artifact.gzipBytes).toBe(Bun.gzipSync(bytes).byteLength);
      expect(artifact.sha256).toBe(sha256(bytes));
      // Windows does not preserve POSIX executable bits. The a-Shell launcher
      // suite verifies those files on POSIX hosts.
      if (isPosixHost(process.platform) && artifact.path !== "ios/kunai-mobile-ios.js") {
        expect(statSync(path).mode & 0o777).toBe(0o755);
      }
    });
  }

  test("produces an executable Node bundle without an embedded Bun runtime", () => {
    const source = readFileSync(join(DIST, "android/kunai-mobile-android.mjs"), "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(source).not.toContain("Bun.");
    expect(source).not.toContain("bun:");
  });

  test("runs help and version from the emitted artifact under Node", () => {
    const artifact = join(DIST, "android/kunai-mobile-android.mjs");
    const help = spawnSync(NODE_RUNTIME, [artifact, "--help"], { encoding: "utf8" });
    const version = spawnSync(NODE_RUNTIME, [artifact, "--version"], { encoding: "utf8" });

    expect(help.status).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage: kunai-mobile");
    expect(version.status).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout.trim()).toBe(`Kunai mobile ${BUILD_METADATA.version}`);
  });

  test("rejects unsafe URLs in the emitted Node artifact before network or launcher work", () => {
    const artifact = join(DIST, "android/kunai-mobile-android.mjs");
    const rejectedUrl = "http://user:secret@media.example/video.m3u8#fragment";
    const result = spawnSync(
      NODE_RUNTIME,
      [
        artifact,
        "--host-proof",
        "--probe-url",
        rejectedUrl,
        "--media-url",
        "https://media.example/video.m3u8",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Invalid mobile command.");
    expect(`${result.stdout}${result.stderr}`).not.toContain(rejectedUrl);
    expect(`${result.stdout}${result.stderr}`).not.toContain("secret");
  });

  test("handles SIGINT at the real Node prompt before any HTTP or player work", async () => {
    const home = mkdtempSync(join(tmpdir(), "kunai-mobile-node-sigint-"));
    const artifact = join(DIST, "android/kunai-mobile-android.mjs");
    try {
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const child = spawn(
          NODE_RUNTIME,
          [
            artifact,
            "--host-proof",
            "--probe-url",
            "https://probe.example/status",
            "--media-url",
            "https://media.example/video.m3u8",
          ],
          { env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        let interrupted = false;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (!interrupted && stdout.includes("Continue? ")) {
            interrupted = true;
            child.kill("SIGINT");
          }
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
      });

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Continue? ");
      expect(
        JSON.parse(readFileSync(join(home, ".local/share/kunai-mobile/mobile-state.json"), "utf8")),
      ).toEqual({ schemaVersion: 1, hostProofRuns: 1, lastResult: "cancelled" });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("exits after typed cancellation while the real Node stdin remains open", async () => {
    const home = mkdtempSync(join(tmpdir(), "kunai-mobile-node-cancel-"));
    const artifact = join(DIST, "android/kunai-mobile-android.mjs");
    const child = spawn(
      NODE_RUNTIME,
      [
        artifact,
        "--host-proof",
        "--probe-url",
        "https://probe.invalid/status",
        "--media-url",
        "https://media.invalid/video.m3u8",
      ],
      { env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let answered = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (answered || !stdout.includes("Continue? ")) return;
      answered = true;
      child.stdin.write(" 0 \n");
    });

    try {
      await waitForMobileHostProof(
        new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => {
            if (code === 0 && signal === null) resolve();
            else reject(new Error("Node cancellation did not exit cleanly"));
          });
        }),
        "Node typed-cancellation lifecycle",
      );
      expect(stdout.match(/Cancel/gu)).toEqual(["Cancel"]);
      expect(stdout).not.toContain("Invalid selection");
    } finally {
      child.kill("SIGKILL");
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keeps the iOS bundle self-contained and the launcher fixed", () => {
    const bundle = readFileSync(join(DIST, "ios/kunai-mobile-ios.js"), "utf8");
    expect(findForbiddenIosOutputTokens(bundle)).toEqual([]);
    const launcher = readFileSync(join(DIST, "ios/kunai-mobile"), "utf8");
    expect(launcher).toContain("jsc ./kunai-mobile-ios.js");
    expect(launcher).not.toContain('jsc ./kunai-mobile-ios.js "$@"');
    expect(launcher).toContain('exit "$mobile_status"');
  });

  test("keeps the emitted HTTP helper on the bounded redirect contract", () => {
    const helper = readFileSync(join(DIST, "ios/kunai-mobile-http"), "utf8");
    expect(helper).toContain("--proto '=https' --proto-redir '=https'");
    expect(helper).toContain("--location --max-redirs 3 --silent --show-error");
    expect(helper).toContain("--config .runtime/curl.conf");
  });

  test("runs the complete host proof through fake a-Shell globals without leaking URLs", async () => {
    const files = new Map<string, string>([
      [".runtime/argv-count", "5"],
      [".runtime/argv-0", "--host-proof"],
      [".runtime/argv-1", "--probe-url"],
      [".runtime/argv-2", "https://probe.example/status?token=probe-secret"],
      [".runtime/argv-3", "--media-url"],
      [".runtime/argv-4", "https://media.example/video.m3u8?token=media-secret"],
    ]);
    const commands: string[] = [];
    const output: string[] = [];
    let completeHostProof: () => void = () => {};
    const hostProofCompleted = new Promise<void>((resolveCompletion) => {
      completeHostProof = resolveCompletion;
    });
    const mediaUrl = "https://media.example/video.m3u8?token=media-secret";
    const probeUrl = "https://probe.example/status?token=probe-secret";
    const previousJsc = globalThis.jsc;
    const previousLog = console.log;
    globalThis.jsc = {
      readFile(path) {
        const value = files.get(path);
        if (value === undefined) throw new Error("missing fake file");
        return value;
      },
      writeFile(path, value) {
        files.set(path, value);
        return 0;
      },
      isFile: (path) => files.has(path),
      makeFolder: () => 0,
      delete(path) {
        files.delete(path);
        return 0;
      },
      move(from, to) {
        const value = files.get(from);
        if (value === undefined || files.has(to)) return 1;
        files.delete(from);
        files.set(to, value);
        if (to === ".runtime/exit-code") completeHostProof();
        return 0;
      },
      system(command) {
        commands.push(command);
        if (command === "./kunai-mobile-read-line") {
          files.set(".runtime/terminal-answer", "1\n");
        } else if (command === "./kunai-mobile-http") {
          files.set(".runtime/http-body", "hello");
          files.set(".runtime/http-meta", "204\n5\n");
        }
        return "0";
      },
    };
    console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));
    try {
      Function(readFileSync(join(DIST, "ios/kunai-mobile-ios.js"), "utf8"))();
      await waitForMobileHostProof(hostProofCompleted, "fake a-Shell integration host proof");
    } finally {
      console.log = previousLog;
      globalThis.jsc = previousJsc;
    }

    expect(commands).toEqual([
      "./kunai-mobile-read-line",
      "./kunai-mobile-http",
      "./kunai-mobile-open-vlc",
    ]);
    expect(JSON.parse(files.get(".runtime/mobile-state.json") ?? "null")).toEqual({
      schemaVersion: 1,
      hostProofRuns: 1,
      lastResult: "handoff-accepted",
    });
    expect(files.get(".runtime/exit-code")).toBe("0");
    expect(JSON.stringify([...files])).not.toContain("secret");
    expect(output.join("\n")).not.toContain(probeUrl);
    expect(output.join("\n")).not.toContain(mediaUrl);
  });
});
