import { describe, expect, test } from "bun:test";

import { copyAndAnnounce } from "../lib/clipboard-copy";

/**
 * The copy button announces `kunai:copied`, which the roaming fox listens for.
 * Both halves of that contract are failure-shaped, so both are covered here:
 * a rejected write must not announce, and a successful write must announce
 * exactly once regardless of which success branch the caller uses.
 */
function spy() {
  const calls: string[] = [];
  return { calls, fn: (value: string) => void calls.push(value) };
}

describe("copyAndAnnounce", () => {
  test("announces after a successful write", async () => {
    const announce = spy();
    let copied = 0;
    const written: string[] = [];

    const ok = await copyAndAnnounce("kunai -S Frieren", "install", {
      writeText: async (value) => void written.push(value),
      announce: announce.fn,
      onCopied: () => void (copied += 1),
    });

    expect(ok).toBe(true);
    expect(written).toEqual(["kunai -S Frieren"]);
    expect(copied).toBe(1);
    expect(announce.calls).toEqual(["install"]);
  });

  test("stays silent when the clipboard rejects", async () => {
    const announce = spy();
    let copied = 0;

    const ok = await copyAndAnnounce("kunai -S Frieren", "install", {
      writeText: () => Promise.reject(new Error("NotAllowedError")),
      announce: announce.fn,
      onCopied: () => void (copied += 1),
    });

    // The whole point: no "Copied", no fox reaction, for a clipboard that never
    // took the text.
    expect(ok).toBe(false);
    expect(copied).toBe(0);
    expect(announce.calls).toEqual([]);
  });

  test("announces exactly once for a caller-supplied success handler", async () => {
    const announce = spy();
    const handled: string[] = [];

    await copyAndAnnounce("irm https://kunai.kitsunekode.in/install.ps1 | iex", "powershell", {
      writeText: () => Promise.resolve(),
      announce: announce.fn,
      // Stands in for the deprecated `onCopy` prop, whose branch used to return
      // before the announcement and so never reached the fox.
      onCopied: () => void handled.push("external"),
    });

    expect(handled).toEqual(["external"]);
    expect(announce.calls).toEqual(["powershell"]);
  });

  test("does not announce when the clipboard API is missing entirely", async () => {
    const announce = spy();

    const ok = await copyAndAnnounce("kunai", "copy", {
      writeText: () => {
        throw new TypeError("navigator.clipboard is undefined");
      },
      announce: announce.fn,
      onCopied: () => {
        throw new Error("must not run");
      },
    });

    expect(ok).toBe(false);
    expect(announce.calls).toEqual([]);
  });
});
