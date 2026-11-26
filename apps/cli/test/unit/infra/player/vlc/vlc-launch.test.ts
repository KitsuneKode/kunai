import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildVlcArgs,
  buildVlcInPlayQuery,
  discoverVlcBinary,
  userVlcConfigPath,
  writeVlcSessionConfig,
} from "@/infra/player/vlc/vlc-launch";

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("discoverVlcBinary", () => {
  const none = () => null;

  test("PATH wins everywhere", () => {
    expect(discoverVlcBinary({ which: () => "/usr/bin/vlc", platform: "linux" })).toBe(
      "/usr/bin/vlc",
    );
  });

  test("macOS finds the app bundle that is not on PATH", () => {
    expect(
      discoverVlcBinary({
        which: none,
        platform: "darwin",
        homeDir: "/Users/me",
        exists: (path) => path === "/Users/me/Applications/VLC.app/Contents/MacOS/VLC",
      }),
    ).toBe("/Users/me/Applications/VLC.app/Contents/MacOS/VLC");
  });

  test("Windows looks under both Program Files roots", () => {
    expect(
      discoverVlcBinary({
        which: none,
        platform: "win32",
        env: { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
        exists: (path) => path === "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
      }),
    ).toBe("C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe");
  });

  test("nothing installed is null, and Flatpak VLC is not used", () => {
    expect(discoverVlcBinary({ which: none, platform: "linux", exists: () => true })).toBeNull();
  });
});

describe("userVlcConfigPath", () => {
  test("follows each OS's VLC preference location", () => {
    expect(userVlcConfigPath({ platform: "linux", env: {}, homeDir: "/home/me" })).toBe(
      "/home/me/.config/vlc/vlcrc",
    );
    expect(
      userVlcConfigPath({ platform: "linux", env: { XDG_CONFIG_HOME: "/xdg" }, homeDir: "/h" }),
    ).toBe("/xdg/vlc/vlcrc");
    expect(userVlcConfigPath({ platform: "darwin", env: {}, homeDir: "/Users/me" })).toBe(
      "/Users/me/Library/Preferences/org.videolan.vlc/vlcrc",
    );
    expect(
      userVlcConfigPath({ platform: "win32", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" } }),
    ).toBe("C:\\Users\\me\\AppData\\Roaming\\vlc\\vlcrc");
  });
});

describe("writeVlcSessionConfig", () => {
  test("keeps the user's settings and appends the password last, owner-only", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vlc-test-"));
    const userRc = join(dir, "user-vlcrc");
    await writeFile(userRc, "[core]\nvolume=200\n[lua]\nhttp-password=theirs");
    const path = await writeVlcSessionConfig({ dir, password: "ours", userConfigPath: userRc });
    const text = await readFile(path, "utf8");
    expect(text).toContain("volume=200");
    // VLC applies the last value of a key, so ours must come after theirs.
    expect(text.lastIndexOf("http-password=ours")).toBeGreaterThan(
      text.indexOf("http-password=theirs"),
    );
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  test("works when the user has never run VLC", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vlc-test-"));
    const path = await writeVlcSessionConfig({
      dir,
      password: "ours",
      userConfigPath: join(dir, "missing"),
    });
    expect(await readFile(path, "utf8")).toContain("[lua]\nhttp-password=ours");
  });
});

describe("buildVlcArgs", () => {
  const base = {
    port: 41234,
    configPath: "/tmp/kunai-vlc-x/vlcrc",
    url: "https://cdn.example/ep1.m3u8",
    title: "Show · S1E1",
  };

  test("loopback control interface, own process, and nothing secret in argv", () => {
    const args = buildVlcArgs(base);
    expect(args).toContain("--http-host=127.0.0.1");
    expect(args).toContain("--http-port=41234");
    expect(args).toContain("--config=/tmp/kunai-vlc-x/vlcrc");
    expect(args).toContain("--no-one-instance");
    expect(args).toContain("--play-and-exit");
    expect(args.some((arg) => arg.includes("password"))).toBe(false);
  });

  test("title, start and subtitle are per-input options after the URL", () => {
    const args = buildVlcArgs({
      ...base,
      startAtSeconds: 754.6,
      subtitle: "http://127.0.0.1:9/g/token/sub/0",
    });
    const url = args.indexOf(base.url);
    expect(args.slice(url + 1)).toEqual([
      ":meta-title=Show · S1E1",
      ":start-time=754",
      // Measured: an HTTP subtitle loads through input-slave, not sub-file.
      ":input-slave=http://127.0.0.1:9/g/token/sub/0",
    ]);
  });

  test("a local subtitle file uses sub-file, and no start time means none", () => {
    const args = buildVlcArgs({ ...base, url: "/media/ep1.mkv", subtitle: "/media/ep1.en.srt" });
    expect(args).toContain(":sub-file=/media/ep1.en.srt");
    expect(args.some((arg) => arg.startsWith(":start-time"))).toBe(false);
  });
});

describe("keeping the window for the next episode", () => {
  const base = {
    port: 41234,
    configPath: "/tmp/kunai-vlc-x/vlcrc",
    url: "https://cdn.example/ep1.m3u8",
    title: "Show · S1E1",
  };

  test("a kept window stops at the end of the file instead of exiting", () => {
    const args = buildVlcArgs({ ...base, keepOpen: true });
    expect(args).toContain("--play-and-stop");
    expect(args).not.toContain("--play-and-exit");
  });

  test("in_play carries the same per-input options a launch does", () => {
    const query = new URLSearchParams(
      buildVlcInPlayQuery({
        url: "http://127.0.0.1:9/g/token/media",
        title: "Show · S1E2",
        startAtSeconds: 90.4,
        subtitle: "http://127.0.0.1:9/g/token/sub/0",
      }),
    );
    expect(query.get("command")).toBe("in_play");
    expect(query.get("input")).toBe("http://127.0.0.1:9/g/token/media");
    expect(query.getAll("option")).toEqual([
      ":meta-title=Show · S1E2",
      ":start-time=90",
      ":input-slave=http://127.0.0.1:9/g/token/sub/0",
    ]);
  });

  test("a local file goes to in_play as a file URI", () => {
    const path = "/media/My Show/ep 2.mkv";
    const query = new URLSearchParams(buildVlcInPlayQuery({ url: path, title: "Ep 2" }));
    const input = query.get("input") ?? "";
    // Windows resolves a rooted path against the current drive
    // (file:///C:/media/...), so pin the encoding, not the drive.
    expect(input).toBe(pathToFileURL(path).href);
    expect(input).toStartWith("file:///");
    expect(input).toEndWith("/media/My%20Show/ep%202.mkv");
  });
});
