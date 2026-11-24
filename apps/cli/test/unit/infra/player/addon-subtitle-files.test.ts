import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import {
  AddonSubtitleFiles,
  prepareLaunchSubtitles,
  resolvePlayerSubtitle,
} from "@/infra/player/addon-subtitle-files";
import { buildMpvArgs } from "@/mpv";

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";

const okDownload = async (): Promise<{ text: string; extension: "srt" }> => ({
  text: SRT,
  extension: "srt",
});

describe("AddonSubtitleFiles", () => {
  test("valid download yields an owned local file; re-selection reuses the path", async () => {
    const files = new AddonSubtitleFiles(okDownload);
    const first = await files.localize("https://subs.example.com/en.srt");
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected a localized path");
    expect(existsSync(first)).toBe(true);
    expect(files.existingPath("https://subs.example.com/en.srt")).toBe(first);
    expect(await files.localize("https://subs.example.com/en.srt")).toBe(first);
    expect(first).not.toContain("subs.example.com");
    await files.close();
    expect(existsSync(first)).toBe(false);
  });

  test("refused download resolves to null and never a raw URL", async () => {
    const files = new AddonSubtitleFiles(async () => null);
    expect(await files.localize("https://subs.example.com/en.srt")).toBeNull();
    expect(
      await resolvePlayerSubtitle(
        "https://subs.example.com/en.srt",
        "remote",
        true,
        undefined,
        files,
      ),
    ).toBeNull();
    await files.close();
  });

  test("close is idempotent and aborts late work", async () => {
    let release: (v: { text: string; extension: "srt" } | null) => void = () => {};
    const files = new AddonSubtitleFiles(() => new Promise((resolve) => (release = resolve)));
    const pending = files.localize("https://subs.example.com/en.srt");
    const closing = files.close();
    release({ text: SRT, extension: "srt" });
    await closing;
    expect(await pending).toBeNull();
    await files.close();
  });
});

describe("prepareLaunchSubtitles", () => {
  test("addon primary + tracks rewrite to local files, metadata preserved", async () => {
    const files = new AddonSubtitleFiles(okDownload);
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
        stremioAddon: true,
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
        stremioAddon: true,
      },
      null,
    );
    expect(args.join(" ")).not.toContain("subs.example.com");
    expect(args.some((arg) => arg.startsWith("--sub-file="))).toBe(true);
    await files.close();
  });

  test("a refused track drops out of the launch inventory entirely", async () => {
    const files = new AddonSubtitleFiles(
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
        stremioAddon: true,
      },
      files,
    );
    expect(prepared.subtitleTracks).toHaveLength(1);
    expect(prepared.subtitleTracks?.[0]?.display).toBe("English");
    await files.close();
  });

  test("non-addon launch passes remote subtitles through untouched", async () => {
    const files = new AddonSubtitleFiles();
    const prepared = await prepareLaunchSubtitles(
      { subtitle: "https://subs.example.com/en.srt", stremioAddon: false },
      files,
    );
    expect(prepared.subtitle).toBe("https://subs.example.com/en.srt");
    await files.close();
  });
});

describe("review followups", () => {
  test("a marked guardedAddon track localizes even on a non-addon playback", async () => {
    const files = new AddonSubtitleFiles(okDownload);
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: null,
        subtitleTracks: [
          {
            url: "https://subs.example.com/en.srt",
            display: "English",
            guardedAddon: true,
          },
          { url: "https://other.example.com/fr.srt", display: "French" },
        ],
        stremioAddon: false,
      },
      files,
    );
    // Marked track rewritten to an owned path; unmarked remote passes through.
    expect(prepared.subtitleTracks).toHaveLength(2);
    const marked = prepared.subtitleTracks?.[0];
    expect(marked?.display).toBe("English");
    expect(marked?.url).toMatch(/\.srt$/);
    expect(marked?.url).not.toContain("subs.example.com");
    expect(prepared.subtitleTracks?.[1]?.url).toBe("https://other.example.com/fr.srt");
    await files.close();
  });

  test("a marked guarded primary is localized and cannot stay remote", async () => {
    const files = new AddonSubtitleFiles(okDownload);
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: "https://subs.example.com/en.srt",
        subtitleTracks: [{ url: "https://subs.example.com/en.srt", guardedAddon: true }],
        stremioAddon: false,
      },
      files,
    );
    expect(prepared.subtitle).toMatch(/\.srt$/);
    expect(prepared.subtitle).not.toContain("subs.example.com");
    expect(prepared.subtitleUrlKind).toBe("local");
    await files.close();
  });

  test("a remote URL dressed as local never escapes: argv refuses it", async () => {
    const files = new AddonSubtitleFiles(async () => null);
    const prepared = await prepareLaunchSubtitles(
      {
        subtitle: "https://subs.example.com/en.srt",
        subtitleUrlKind: "local", // kind flag is not proof of local
        subtitleTracks: [{ url: "https://subs.example.com/en.srt", guardedAddon: true }],
        stremioAddon: false,
      },
      files,
    );
    // shouldLocalize catches it (marked + remote) and the refused download
    // drops the primary entirely.
    expect(prepared.subtitle).toBeNull();
    const args = buildMpvArgs(
      {
        url: "https://media.example.com/file.mp4",
        headers: {},
        subtitle: "https://subs.example.com/en.srt",
        subtitleUrlKind: "local",
        subtitleTracks: [{ url: "https://subs.example.com/en.srt", guardedAddon: true }],
        displayTitle: "t",
      },
      null,
    );
    expect(args.join(" ")).not.toContain("subs.example.com");
    await files.close();
  });

  test("close removes both the files and their containing directory", async () => {
    const { dirname } = await import("node:path");
    const files = new AddonSubtitleFiles(okDownload);
    const path = await files.localize("https://subs.example.com/en.srt");
    if (!path) throw new Error("expected a localized path");
    const dir = dirname(path);
    expect(existsSync(dir)).toBe(true);
    await files.close();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });
});
