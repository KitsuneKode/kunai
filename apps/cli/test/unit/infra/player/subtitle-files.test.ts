import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  SubtitleFiles,
  prepareLaunchSubtitles,
  resolvePlayerSubtitle,
} from "@/infra/player/subtitle-files";
import { buildMpvArgs } from "@/mpv";

import { applyStorageRootEnv } from "../../../helpers/storage-env";
import { removeTempDir } from "../../../support/remove-temp-dir";

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";

let testRoot: string;
let restoreStorage: () => void;
type TempDirEnv = Pick<NodeJS.ProcessEnv, "TMPDIR" | "TMP" | "TEMP">;
let previousTempDirs: TempDirEnv;
beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "kunai-subs-test-"));
  restoreStorage = applyStorageRootEnv(testRoot);
  // tempDir follows TMPDIR/TMP/TEMP, not the storage root — this suite opens
  // no IPC socket, so a long per-test temp root is safe here.
  previousTempDirs = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  process.env.TMPDIR = testRoot;
  process.env.TMP = testRoot;
  process.env.TEMP = testRoot;
});
afterEach(() => {
  for (const [key, value] of Object.entries(previousTempDirs)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  restoreStorage();
  removeTempDir(testRoot);
});

const okDownload = async (): Promise<{ text: string; extension: "srt" }> => ({
  text: SRT,
  extension: "srt",
});

describe("SubtitleFiles", () => {
  test("valid download yields an owned local file; re-selection reuses the path", async () => {
    const files = new SubtitleFiles(okDownload);
    const first = await files.localize("https://subs.example.com/en.srt");
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected a localized path");
    expect(existsSync(first)).toBe(true);
    // Owned files live under this test's redirected temp root, never loose in
    // the OS temp or in a profile directory.
    const insideTemp = relative(testRoot, first);
    expect(insideTemp.startsWith("..")).toBe(false);
    expect(insideTemp).not.toBe("");
    expect(files.existingPath("https://subs.example.com/en.srt")).toBe(first);
    expect(await files.localize("https://subs.example.com/en.srt")).toBe(first);
    expect(first).not.toContain("subs.example.com");
    await files.close();
    expect(existsSync(first)).toBe(false);
  });

  test("refused download resolves to null and never a raw URL", async () => {
    const files = new SubtitleFiles(async () => null);
    expect(await files.localize("https://subs.example.com/en.srt")).toBeNull();
    expect(
      await resolvePlayerSubtitle("https://subs.example.com/en.srt", "remote", files),
    ).toBeNull();
    await files.close();
  });

  test("close is idempotent and aborts late work", async () => {
    let release: (v: { text: string; extension: "srt" } | null) => void = () => {};
    const files = new SubtitleFiles(() => new Promise((resolve) => (release = resolve)));
    const pending = files.localize("https://subs.example.com/en.srt");
    const closing = files.close();
    release({ text: SRT, extension: "srt" });
    await closing;
    expect(await pending).toBeNull();
    await files.close();
  });
});

describe("prepareLaunchSubtitles", () => {
  test("remote primary and alternative tracks rewrite to local files with metadata", async () => {
    const files = new SubtitleFiles(okDownload);
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: "https://subs.example.com/en.srt",
        subtitleTracks: [
          {
            url: "https://subs.example.com/en.srt",
            display: "English",
            language: "en",
          },
          {
            url: "https://subs.example.com/fr.srt",
            display: "Français",
            language: "fr",
          },
        ],
      },
      files,
    );
    expect(prepared.subtitle).toMatch(/\.srt$/);
    expect(prepared.subtitleUrlKind).toBe("local");
    expect(prepared.localSubtitlePaths.has(prepared.subtitle!)).toBe(true);
    expect(prepared.subtitleTracks).toHaveLength(2);
    expect(prepared.subtitleTracks?.[1]?.display).toBe("Français");
    expect(prepared.subtitleTracks?.[1]?.language).toBe("fr");
    // argv contains only owned paths — never the remote subtitle URL.
    const args = buildMpvArgs(
      {
        url: "https://media.example.com/file.mp4",
        headers: {},
        subtitle: prepared.subtitle,
        subtitleUrlKind: prepared.subtitleUrlKind,
        subtitleTracks: prepared.subtitleTracks,
        localSubtitlePaths: prepared.localSubtitlePaths,
        displayTitle: "t",
      },
      null,
    );
    expect(args.join(" ")).not.toContain("subs.example.com");
    expect(args.some((arg) => arg.startsWith("--sub-file="))).toBe(true);
    await files.close();
  });

  test("a refused track drops out of the launch inventory entirely", async () => {
    const files = new SubtitleFiles(
      async (url): Promise<{ text: string; extension: "srt" } | null> =>
        url.includes("en.srt") ? { text: SRT, extension: "srt" } : null,
    );
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: null,
        subtitleTracks: [
          { url: "https://subs.example.com/en.srt", display: "English" },
          { url: "https://subs.example.com/evil.m3u8", display: "Bad" },
        ],
      },
      files,
    );
    expect(prepared.subtitleTracks).toHaveLength(1);
    expect(prepared.subtitleTracks?.[0]?.display).toBe("English");
    await files.close();
  });

  test("a remote URL dressed as local never escapes: argv refuses it", async () => {
    const files = new SubtitleFiles(async () => null);
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: "https://subs.example.com/en.srt",
        subtitleUrlKind: "local", // kind flag is not proof of local
        subtitleTracks: [{ url: "https://subs.example.com/en.srt" }],
      },
      files,
    );
    expect(prepared.subtitle).toBeNull();
    const args = buildMpvArgs(
      {
        url: "https://media.example.com/file.mp4",
        headers: {},
        subtitle: "https://subs.example.com/en.srt",
        subtitleUrlKind: "local",
        subtitleTracks: [{ url: "https://subs.example.com/en.srt" }],
        displayTitle: "t",
      },
      null,
    );
    expect(args.join(" ")).not.toContain("subs.example.com");
    await files.close();
  });

  test("close removes both the files and their containing directory", async () => {
    const { dirname } = await import("node:path");
    const files = new SubtitleFiles(okDownload);
    const path = await files.localize("https://subs.example.com/en.srt");
    if (!path) throw new Error("expected a localized path");
    const dir = dirname(path);
    expect(existsSync(dir)).toBe(true);
    await files.close();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });
});
