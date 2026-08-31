import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  findForbiddenIosOutputTokens,
  MOBILE_TARGETS,
  type MobileBuildMetadata,
} from "../../scripts/build-contract";

const MOBILE_ROOT = join(import.meta.dir, "../..");
const DIST = join(MOBILE_ROOT, "dist");

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

describe("mobile build artifacts", () => {
  test("match the target, checksum, size, and executable-mode manifest", () => {
    const metadata = JSON.parse(
      readFileSync(join(DIST, "mobile-build-meta.json"), "utf8"),
    ) as MobileBuildMetadata;
    expect(metadata.schemaVersion).toBe(1);
    expect(metadata.targets.map((target) => target.id)).toEqual(
      MOBILE_TARGETS.map((target) => target.id),
    );
    expect(metadata.artifacts.map((artifact) => artifact.path)).toEqual([
      "kunai-mobile-android-arm64",
      "kunai-mobile-android-x64",
      "ios/kunai-mobile",
      "ios/kunai-mobile-http",
      "ios/kunai-mobile-ios.js",
      "ios/kunai-mobile-open-vlc",
      "ios/kunai-mobile-read-line",
    ]);

    for (const artifact of metadata.artifacts) {
      const path = join(DIST, artifact.path);
      const bytes = readFileSync(path);
      expect(artifact.bytes).toBe(bytes.byteLength);
      expect(artifact.gzipBytes).toBe(Bun.gzipSync(bytes).byteLength);
      expect(artifact.sha256).toBe(sha256(bytes));
      if (artifact.path !== "ios/kunai-mobile-ios.js") {
        expect(statSync(path).mode & 0o777).toBe(0o755);
      }
    }
  });

  test("produces the requested little-endian 64-bit Android ELF machines", () => {
    for (const [name, machine] of [
      ["kunai-mobile-android-arm64", 183],
      ["kunai-mobile-android-x64", 62],
    ] as const) {
      const bytes = readFileSync(join(DIST, name));
      expect([...bytes.subarray(0, 4)]).toEqual([0x7f, 0x45, 0x4c, 0x46]);
      expect(bytes[4]).toBe(2);
      expect(bytes[5]).toBe(1);
      expect(bytes.readUInt16LE(18)).toBe(machine);
    }
  });

  test("keeps the iOS bundle self-contained and the launcher fixed", () => {
    const bundle = readFileSync(join(DIST, "ios/kunai-mobile-ios.js"), "utf8");
    expect(findForbiddenIosOutputTokens(bundle)).toEqual([]);
    const launcher = readFileSync(join(DIST, "ios/kunai-mobile"), "utf8");
    expect(launcher).toContain('jsc ./kunai-mobile-ios.js "$@"');
    expect(launcher).toContain('exit "$mobile_status"');
  });

  test("keeps the emitted HTTP helper on the bounded redirect contract", () => {
    const helper = readFileSync(join(DIST, "ios/kunai-mobile-http"), "utf8");
    expect(helper).toContain("--proto '=http,https' --proto-redir '=http,https'");
    expect(helper).toContain("--location --max-redirs 3 --silent --show-error");
    expect(helper).toContain("--config .runtime/curl.conf");
  });

  test("runs the complete host proof through fake a-Shell globals without leaking URLs", async () => {
    const files = new Map<string, string>();
    const commands: string[] = [];
    const output: string[] = [];
    let completeHostProof: () => void = () => {};
    const hostProofCompleted = new Promise<void>((resolveCompletion) => {
      completeHostProof = resolveCompletion;
    });
    const mediaUrl = "https://media.example/video.m3u8?token=media-secret";
    const probeUrl = "https://probe.example/status?token=probe-secret";
    const previousArgv = process.argv;
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
      deleteFile(path) {
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
    process.argv = [
      "jsc",
      "kunai-mobile-ios.js",
      "--host-proof",
      "--probe-url",
      probeUrl,
      "--media-url",
      mediaUrl,
    ];
    console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));
    try {
      Function(readFileSync(join(DIST, "ios/kunai-mobile-ios.js"), "utf8"))();
      await hostProofCompleted;
    } finally {
      console.log = previousLog;
      process.argv = previousArgv;
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
