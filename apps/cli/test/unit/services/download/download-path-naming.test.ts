import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  clampComponent,
  resolveDownloadOutputPath,
  sanitizePathPart,
} from "@/services/download/download-path-naming";

const utf8 = new TextEncoder();
const bytes = (value: string) => utf8.encode(value).length;

describe("sanitizePathPart", () => {
  test("replaces characters Windows forbids, keeping words apart", () => {
    expect(sanitizePathPart("Ghost in the Shell: SAC_2045")).toBe("Ghost in the Shell SAC_2045");
    expect(sanitizePathPart('A<B>C:D"E/F\\G|H?I*J')).toBe("A B C D E F G H I J");
  });

  test("strips control characters", () => {
    expect(sanitizePathPart("Attack\u0000 on\u001f Titan")).toBe("Attack on Titan");
  });

  test("strips trailing dots and spaces that Windows rejects", () => {
    expect(sanitizePathPart("Firefly. ")).toBe("Firefly");
    expect(sanitizePathPart("Mr. Robot...")).toBe("Mr. Robot");
  });

  test("keeps non-ASCII titles intact", () => {
    expect(sanitizePathPart("鋼の錬金術師")).toBe("鋼の錬金術師");
    expect(sanitizePathPart("Amélie")).toBe("Amélie");
  });

  test("escapes MS-DOS device names that Windows resolves as devices", () => {
    // `NUL.mp4` is not a file on Windows — writes to it are silently discarded.
    for (const reserved of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT9"]) {
      expect(sanitizePathPart(reserved)).toBe(`${reserved}_`);
    }
  });

  test("leaves names that merely start with a device name alone", () => {
    expect(sanitizePathPart("Con Air")).toBe("Con Air");
    expect(sanitizePathPart("Nulla")).toBe("Nulla");
  });

  test("returns empty when nothing usable survives, for the caller to default", () => {
    expect(sanitizePathPart("   ...   ")).toBe("");
  });
});

describe("clampComponent", () => {
  test("leaves short names untouched", () => {
    expect(clampComponent("Dune.mp4", 255)).toBe("Dune.mp4");
  });

  test("truncates the stem but preserves the extension", () => {
    const clamped = clampComponent(`${"a".repeat(300)}.mp4`, 255);
    expect(clamped.endsWith(".mp4")).toBe(true);
    expect(bytes(clamped)).toBeLessThanOrEqual(255);
  });

  test("counts UTF-8 bytes, not UTF-16 units, for CJK titles", () => {
    // Each of these is 3 bytes in UTF-8, so 255 bytes is 85 characters.
    const clamped = clampComponent(`${"錬".repeat(200)}.mp4`, 255);
    expect(bytes(clamped)).toBeLessThanOrEqual(255);
    expect(clamped.endsWith(".mp4")).toBe(true);
  });

  test("never splits a surrogate pair", () => {
    const clamped = clampComponent(`${"🎬".repeat(100)}.mp4`, 64);
    expect(bytes(clamped)).toBeLessThanOrEqual(64);
    // A lone surrogate would not survive an encode/decode round trip: it
    // encodes to U+FFFD. Emoji are *made of* surrogate pairs, so the pairs
    // themselves are expected — only unpaired ones indicate a bad cut.
    expect(new TextDecoder().decode(utf8.encode(clamped))).toBe(clamped);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(clamped).not.toMatch(loneSurrogate);
    // 15 emoji at 4 bytes each plus ".mp4" is exactly the 64-byte budget.
    expect(clamped).toBe(`${"🎬".repeat(15)}.mp4`);
  });
});

describe("resolveDownloadOutputPath", () => {
  test("builds the documented episode layout on POSIX", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/home/u/Downloads",
        titleName: "Frieren",
        year: "2023",
        position: {
          kind: "episode",
          season: 1,
          episode: 4,
          seasonIsMeaningful: true,
        },
        extension: ".mp4",
        platform: "linux",
      }),
    ).toBe("/home/u/Downloads/Frieren (2023)/Season 01/Frieren - S01E04.mp4");
  });

  test("builds the documented movie layout on POSIX", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/home/u/Downloads",
        titleName: "Dune",
        year: "2021",
        position: { kind: "title" },
        extension: ".mp4",
        platform: "linux",
      }),
    ).toBe("/home/u/Downloads/Dune (2021)/Dune (2021).mp4");
  });

  test("uses backslashes when the target is Windows, from any host", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "C:\\Users\\u\\Downloads",
      titleName: "Frieren",
      year: "2023",
      position: {
        kind: "episode",
        season: 1,
        episode: 4,
        seasonIsMeaningful: true,
      },
      extension: ".mp4",
      platform: "win32",
    });
    expect(path).toBe("C:\\Users\\u\\Downloads\\Frieren (2023)\\Season 01\\Frieren - S01E04.mp4");
  });

  test("falls back to Untitled rather than emitting an empty component", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "/d",
      titleName: "   ",
      position: { kind: "title" },
      extension: ".mp4",
      platform: "linux",
    });
    expect(path).toBe("/d/Untitled/Untitled.mp4");
  });

  test("keeps a Windows path within MAX_PATH for a very long title", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "C:\\Users\\somebody\\Videos\\kunai",
      // Long light-novel style titles are the realistic case here.
      titleName:
        "Kono Subarashii Sekai ni Shukufuku wo Legend of Crimson Extremely Long Edition Director's Cut",
      year: "2024",
      position: {
        kind: "episode",
        season: 2,
        episode: 11,
        seasonIsMeaningful: true,
      },
      extension: ".mp4",
      platform: "win32",
    });
    expect(path.length).toBeLessThanOrEqual(260);
    // The parts a user needs to identify the file must survive truncation.
    expect(path).toContain("Season 02");
    expect(path.endsWith(".mp4")).toBe(true);
    expect(path).toContain("S02E11");
  });

  test("does not truncate a normal-length Windows path", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "C:\\Users\\u\\Downloads",
      titleName: "Severance",
      year: "2022",
      position: {
        kind: "episode",
        season: 1,
        episode: 2,
        seasonIsMeaningful: true,
      },
      extension: ".mp4",
      platform: "win32",
    });
    expect(path).toBe(
      "C:\\Users\\u\\Downloads\\Severance (2022)\\Season 01\\Severance - S01E02.mp4",
    );
  });

  test("escapes a device-name title so Windows writes a real file", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "C:\\dl",
      titleName: "NUL",
      position: { kind: "title" },
      extension: ".mp4",
      platform: "win32",
    });
    expect(path).toBe("C:\\dl\\NUL_\\NUL_.mp4");
  });

  test("a title-level movie position produces the movie layout", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/downloads",
        titleName: "Dune: Part Two",
        year: "2024",
        extension: ".mkv",
        position: { kind: "title" },
        platform: "linux",
      }),
    ).toBe("/downloads/Dune Part Two (2024)/Dune Part Two (2024).mkv");
  });

  test("an episode position without a meaningful season omits the season folder and prefix", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/downloads",
        titleName: "Frieren",
        extension: ".mkv",
        position: {
          kind: "episode",
          episode: 4,
          seasonIsMeaningful: false,
        },
        platform: "linux",
      }),
    ).toBe("/downloads/Frieren/Frieren - E04.mkv");
  });

  test("a season carried without the meaningful flag is not rendered", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/downloads",
        titleName: "Frieren",
        extension: ".mkv",
        position: {
          kind: "episode",
          season: 2,
          episode: 4,
          seasonIsMeaningful: false,
        },
        platform: "linux",
      }),
    ).toBe("/downloads/Frieren/Frieren - E04.mkv");
  });

  test("sanitization still runs after the canonical suffix is produced", () => {
    expect(
      resolveDownloadOutputPath({
        baseDir: "/downloads",
        titleName: "Face/Off: Redux",
        extension: ".mkv",
        position: {
          kind: "episode",
          episode: 4,
          seasonIsMeaningful: false,
        },
        platform: "linux",
      }),
    ).toBe("/downloads/Face Off Redux/Face Off Redux - E04.mkv");
  });

  test("pads season and episode numbers and guards against zero", () => {
    const path = resolveDownloadOutputPath({
      baseDir: "/d",
      titleName: "Show",
      position: {
        kind: "episode",
        season: 0,
        episode: 0,
        seasonIsMeaningful: true,
      },
      extension: ".mp4",
      platform: "linux",
    });
    expect(path).toBe("/d/Show/Season 01/Show - S01E01.mp4");
  });
});

/**
 * Naming stability.
 *
 * These paths are not just strings: resume, repair and library scanning all
 * look a download up by the exact path that produced it. Changing naming
 * silently orphans everything a user has already downloaded, and the symptom
 * (re-downloading files that are plainly on disk) is far removed from the
 * cause. This corpus is the contract — update it only with a migration.
 */
describe("naming stability for existing libraries", () => {
  const base = "/home/u/Downloads";
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["Frieren: Beyond Journey's End", "Frieren Beyond Journey's End"],
    ["Ghost in the Shell: SAC_2045", "Ghost in the Shell SAC_2045"],
    ["Spider-Man: No Way Home", "Spider-Man No Way Home"],
    ["Face/Off", "Face Off"],
    ["M*A*S*H", "M A S H"],
    ["What's Up, Doc?", "What's Up, Doc"],
    ["Steins;Gate", "Steins;Gate"],
    ["Re:Zero − Starting Life in Another World", "Re Zero − Starting Life in Another World"],
    ["鋼の錬金術師 FULLMETAL ALCHEMIST", "鋼の錬金術師 FULLMETAL ALCHEMIST"],
    ["WALL·E", "WALL·E"],
    ["Kimi no Na wa.", "Kimi no Na wa"],
    ["  Spaced Out  ", "Spaced Out"],
  ];

  for (const [raw, expected] of cases) {
    test(`"${raw}" keeps its established folder name`, () => {
      expect(
        resolveDownloadOutputPath({
          baseDir: base,
          titleName: raw,
          year: "2023",
          position: {
            kind: "episode",
            season: 1,
            episode: 4,
            seasonIsMeaningful: true,
          },
          extension: ".mp4",
          platform: "linux",
        }),
      ).toBe(`${base}/${expected} (2023)/Season 01/${expected} - S01E04.mp4`);
    });
  }
});

/**
 * The sanitiser's whole purpose is that the result can be created. Asserting on
 * strings alone would pass just as happily for a name the OS rejects, so these
 * put the generated path through the real filesystem on the host platform.
 */
describe("generated paths are creatable on this host", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  const hostPlatform: NodeJS.Platform = process.platform;
  const hostile = [
    "Frieren: Beyond Journey's End",
    "Face/Off",
    'A"quoted"title',
    "Trailing dots...",
    "鋼の錬金術師",
    "NUL",
    "CON",
    "a".repeat(400),
  ];

  for (const title of hostile) {
    test(`writes a real file for ${JSON.stringify(title.slice(0, 24))}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "kunai-dlpath-"));
      made.push(root);

      const target = resolveDownloadOutputPath({
        baseDir: root,
        titleName: title,
        year: "2024",
        position: {
          kind: "episode",
          season: 1,
          episode: 2,
          seasonIsMeaningful: true,
        },
        extension: ".mp4",
        platform: hostPlatform,
      });

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "video-bytes");

      expect(existsSync(target)).toBe(true);
      expect(await readFile(target, "utf8")).toBe("video-bytes");
      // Everything must stay inside the download root: no traversal, no
      // absolute-path escape from a hostile title.
      expect(target.startsWith(root)).toBe(true);
    });
  }
});
