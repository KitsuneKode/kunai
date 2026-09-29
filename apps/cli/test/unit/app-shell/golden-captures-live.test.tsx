import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { BrowseIdleReturnLoopPreview } from "../../harness/capture-browse";
import { CalendarList, CalendarStrip } from "../../harness/capture-calendar";
import { postPlayFixtures } from "../../harness/capture-demo";
import { DownloadsCapture } from "../../harness/capture-downloads";
import { historyContinueNode } from "../../harness/capture-history";
import { libraryCaptureFixture, POPULATED_ENTRIES } from "../../harness/capture-library";
import { playbackErrorNode } from "../../harness/capture-playback-error";
import { settingsFixtures } from "../../harness/capture-settings";
import { SETUP_ROWS, SETUP_SCREENS, setupFrameAt } from "../../harness/capture-setup";
import { statsFixtures } from "../../harness/capture-stats";
import {
  CAPTURE_WIDTHS,
  captureAllWidths,
  captureFramesSettled,
  type CaptureWidth,
} from "../../harness/render-capture";

const CAPTURE_DIR = path.join(import.meta.dir, "../../__captures__");
// SAFETY: deliberately partial test stub — the test only exercises the members it defines.
const WIDTHS = Object.keys(CAPTURE_WIDTHS) as CaptureWidth[];
const DEFAULT_ROWS = 45;

/**
 * A committed capture that nothing re-renders is a photograph of a component
 * that may no longer exist: rename a row label, skip the re-capture, and the
 * file-read assertions in golden-captures.test.ts still pass (#469). These
 * tests mount each surface's real capture fixture and require the frame to
 * match the committed file byte-for-byte — so a UI change without a re-capture
 * is a red test, not a stale artifact.
 *
 * Regenerate a stale capture with its harness script, e.g.
 * `bun run test/harness/capture-downloads.tsx` from apps/cli.
 */
async function expectLiveMatch(
  surface: string,
  width: CaptureWidth,
  rows: number,
  frame: string,
): Promise<void> {
  const file = path.join(CAPTURE_DIR, `${surface}.${width}.txt`);
  const committed = await readFile(file, "utf8");
  const live = `# ${surface} · ${width} (${CAPTURE_WIDTHS[width]}×${rows})\n${frame}\n`;
  expect(
    live,
    `${surface}.${width}.txt does not match a fresh render — re-run the surface's capture script in apps/cli/test/harness/`,
  ).toBe(committed);
}

describe("committed captures match a live re-render", () => {
  let previousPoster: string | undefined;
  let previousReducedMotion: string | undefined;
  beforeAll(() => {
    previousPoster = process.env.KUNAI_POSTER;
    process.env.KUNAI_POSTER = "0";
    previousReducedMotion = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
  });
  afterAll(() => {
    if (previousPoster === undefined) delete process.env.KUNAI_POSTER;
    else process.env.KUNAI_POSTER = previousPoster;
    if (previousReducedMotion === undefined) delete process.env.KUNAI_REDUCED_MOTION;
    else process.env.KUNAI_REDUCED_MOTION = previousReducedMotion;
  });

  test("downloads", async () => {
    const frames = captureAllWidths(<DownloadsCapture />);
    for (const width of WIDTHS) {
      await expectLiveMatch("downloads", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("calendar-rows", async () => {
    const frames = captureAllWidths(<CalendarList />);
    for (const width of WIDTHS) {
      await expectLiveMatch("calendar-rows", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("calendar-daystrip", async () => {
    const frames = captureAllWidths(<CalendarStrip />);
    for (const width of WIDTHS) {
      await expectLiveMatch("calendar-daystrip", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("library-empty", async () => {
    const frames = await captureFramesSettled(libraryCaptureFixture([]));
    for (const width of WIDTHS) {
      await expectLiveMatch("library-empty", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("library-populated", async () => {
    const frames = await captureFramesSettled(libraryCaptureFixture(POPULATED_ENTRIES));
    for (const width of WIDTHS) {
      await expectLiveMatch("library-populated", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("browse-idle-return-loop", async () => {
    const frames = captureAllWidths(<BrowseIdleReturnLoopPreview />);
    for (const width of WIDTHS) {
      await expectLiveMatch("browse-idle-return-loop", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("history-continue", async () => {
    const frames = captureAllWidths(historyContinueNode());
    for (const width of WIDTHS) {
      await expectLiveMatch("history-continue", width, DEFAULT_ROWS, frames[width]);
    }
  });

  test("playback-error", async () => {
    const frames = captureAllWidths(playbackErrorNode());
    for (const width of WIDTHS) {
      await expectLiveMatch("playback-error", width, DEFAULT_ROWS, frames[width]);
    }
  });

  for (const [name, node] of settingsFixtures()) {
    test(name, async () => {
      const frames = captureAllWidths(node);
      for (const width of WIDTHS) {
        await expectLiveMatch(name, width, DEFAULT_ROWS, frames[width]);
      }
    });
  }

  for (const [name, node] of statsFixtures()) {
    test(name, async () => {
      const frames = captureAllWidths(node);
      for (const width of WIDTHS) {
        await expectLiveMatch(name, width, DEFAULT_ROWS, frames[width]);
      }
    });
  }

  for (const [name, node] of postPlayFixtures()) {
    test(name, async () => {
      const frames = captureAllWidths(node);
      for (const width of WIDTHS) {
        await expectLiveMatch(name, width, DEFAULT_ROWS, frames[width]);
      }
    });
  }

  for (const [index, name] of SETUP_SCREENS.entries()) {
    test(`setup-${index + 1}-${name}`, async () => {
      for (const width of WIDTHS) {
        await expectLiveMatch(
          `setup-${index + 1}-${name}`,
          width,
          SETUP_ROWS,
          setupFrameAt(index, CAPTURE_WIDTHS[width]),
        );
      }
    });
  }
});
