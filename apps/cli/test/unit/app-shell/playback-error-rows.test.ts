import { describe, expect, test } from "bun:test";

import { buildErrorRows, rowText } from "@/app-shell/playback-error-rows";
import { measureColumns } from "@/domain/text-display";

const base = { message: "An unknown error occurred", canRetry: true };

const linesOf = (input: Parameters<typeof buildErrorRows>[0]) => buildErrorRows(input).map(rowText);

describe("buildErrorRows", () => {
  test("always opens with the headline and closes with the actions row", () => {
    const lines = linesOf(base);
    expect(lines[0]).toBe("Playback failed");
    expect(lines.at(-1)).toBe("r retry  ·  Enter / Esc dismiss");
  });

  test("the headline is the only danger-strong row", () => {
    const rows = buildErrorRows(base);
    const strong = rows.filter((row) => row.segments.some((s) => s.tone === "danger-strong"));
    expect(strong).toHaveLength(1);
    expect(rowText(strong[0]!)).toBe("Playback failed");
  });

  test("drops the retry hint when retry is unavailable", () => {
    expect(linesOf({ ...base, canRetry: false }).at(-1)).toBe("Enter / Esc to continue");
  });

  test("falls back to the raw message when there is no scenario", () => {
    expect(linesOf(base)).toContain("An unknown error occurred");
  });

  test("renders provider-timeout", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 },
    });
    expect(lines).toContain("✗  timed out after 12s");
    expect(lines).toContain("allmanga");
    expect(lines).toContain("r retry · /fallback for another provider");
  });

  test("renders stream-broken", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "stream-broken", attempt: 2, maxAttempts: 3 },
    });
    expect(lines).toContain("✗  stream interrupted");
    expect(lines).toContain("attempt 2 of 3");
  });

  test("renders network-offline, keeping the library hint on accent", () => {
    const rows = buildErrorRows({ ...base, scenario: { kind: "network-offline" } });
    expect(rows.map(rowText)).toContain("○  offline");
    const hint = rows.find((row) => rowText(row) === "/library for downloaded titles");
    expect(hint?.segments[0]?.tone).toBe("accent");
  });

  test("renders provider-session", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "provider-session", providerName: "Videasy" },
    });
    expect(lines).toContain("●  Videasy session required");
  });

  test("renders title-unavailable", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "title-unavailable", title: "Dune" },
    });
    expect(lines).toContain("◌  Dune not found");
  });

  test("renders the waterfall with status-toned markers", () => {
    const rows = buildErrorRows({
      ...base,
      waterfall: {
        title: "Source attempts",
        truncated: false,
        rows: [
          { label: "search", detail: "0.4s", status: "succeeded" },
          { label: "resolve", detail: "timed out", status: "failed" },
          { label: "play", detail: null, status: "running" },
        ],
      },
    });
    const lines = rows.map(rowText);
    expect(lines).toContain("Source attempts");
    expect(lines).toContain("✓ search  ·  0.4s");
    expect(lines).toContain("x resolve  ·  timed out");
    expect(lines).toContain("· play");

    const succeeded = rows.find((row) => rowText(row).startsWith("✓ search"));
    expect(succeeded?.segments[0]?.tone).toBe("ok");
    const failed = rows.find((row) => rowText(row).startsWith("x resolve"));
    expect(failed?.segments[0]?.tone).toBe("danger");
  });

  test("marks a truncated waterfall", () => {
    const lines = linesOf({
      ...base,
      waterfall: {
        title: "Provider attempts",
        truncated: true,
        rows: [{ label: "search", detail: null, status: "failed" }],
      },
    });
    expect(lines).toContain("Provider attempts  ·  more in /diagnostics");
  });

  test("appends the debug excerpt when present, and omits it otherwise", () => {
    const withDebug = linesOf({
      ...base,
      debugExcerpt: { message: "ECONNRESET", topFrame: "at resolve (x.ts:1:1)" },
    });
    expect(withDebug).toContain("debug");
    expect(withDebug).toContain("ECONNRESET");
    expect(withDebug).toContain("at resolve (x.ts:1:1)");

    expect(linesOf(base)).not.toContain("debug");
  });

  test("wraps a long message to the text width instead of clipping it", () => {
    const message =
      "videasy resolve failed — the provider returned a malformed stream manifest for every candidate";
    const rows = buildErrorRows({ ...base, message, textWidth: 32 });
    const lines = rows.map(rowText);

    const messageRows = lines.filter((line) => message.split(" ").some((w) => line.includes(w)));
    expect(messageRows.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureColumns(line)).toBeLessThanOrEqual(32);
    }
    // The reason survives — the one sentence that says what failed is not cut.
    expect(lines.join(" ")).toContain("malformed stream manifest");
  });

  test("a long message without a text width is still a single row", () => {
    const message = "a failure message longer than any reasonable panel width would allow";
    const lines = linesOf({ ...base, message });
    expect(lines).toContain(message);
  });

  test("a longer panel produces more rows, which lengthens the fall", () => {
    const short = buildErrorRows(base).length;
    const long = buildErrorRows({
      ...base,
      scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 },
      waterfall: {
        title: "Source attempts",
        truncated: false,
        rows: [{ label: "search", detail: "0.4s", status: "succeeded" }],
      },
      debugExcerpt: { message: "ECONNRESET", topFrame: null },
    }).length;
    expect(long).toBeGreaterThan(short);
  });

  test("strips terminal escapes from provider-controlled rows", () => {
    // Provider names, titles, and failure details reach these rows verbatim;
    // an OSC hyperlink or CSI sequence must not survive to the terminal.
    const evil = "vid\x1b]8;;https://evil.example\x07easy\x1b[2J";
    const lines = linesOf({
      ...base,
      scenario: { kind: "provider-timeout", providerName: evil, elapsedSec: 12 },
    });
    for (const line of lines) {
      expect(line).not.toContain("\x1b");
      expect(line).not.toContain("\x07");
    }
    expect(lines).toContain("videasy");

    const titleLines = linesOf({
      ...base,
      scenario: { kind: "title-unavailable", title: `Dune\x1b]0;pwned\x07` },
    });
    // The whole OSC sequence (introducer, payload, terminator) is removed.
    expect(titleLines).toContain("◌  Dune not found");
  });
});
