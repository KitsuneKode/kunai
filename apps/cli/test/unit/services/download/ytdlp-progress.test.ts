import { expect, test } from "bun:test";

import { parseYtDlpProgressLine } from "@/services/download/ytdlp-progress";

test("parses a full progress line with size speed and ETA", () => {
  expect(parseYtDlpProgressLine("[download]  34.5% of ~1.21GiB at  5.43MiB/s ETA 00:23")).toEqual({
    percent: 34.5,
    sizeLabel: "1.21GiB",
    speedLabel: "5.43MiB/s",
    etaLabel: "00:23",
  });
});

test("parses percent-only lines when the size tail is absent", () => {
  expect(parseYtDlpProgressLine("[download]   2.1%")).toEqual({
    percent: 2.1,
    sizeLabel: undefined,
    speedLabel: undefined,
    etaLabel: undefined,
  });
});

test("tolerates unknown sizes and fragment progress", () => {
  expect(
    parseYtDlpProgressLine("[download]  60.0% of Unknown size at  800.00KiB/s ETA Unknown"),
  ).toMatchObject({ percent: 60, speedLabel: "800.00KiB/s" });
  expect(
    parseYtDlpProgressLine("[download]  15.2% of   42.10MiB at  1.10MiB/s ETA 01:12"),
  ).toMatchObject({ sizeLabel: "42.10MiB", speedLabel: "1.10MiB/s", etaLabel: "01:12" });
});

test("returns null for non-progress lines", () => {
  expect(parseYtDlpProgressLine("[info] Downloading 1 format(s): 137+140")).toBeNull();
  expect(parseYtDlpProgressLine("")).toBeNull();
});
