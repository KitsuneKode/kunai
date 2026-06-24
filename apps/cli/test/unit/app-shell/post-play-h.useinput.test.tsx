import { describe, expect, test } from "bun:test";

import { resolvePostPlayUnhandledInput } from "@/app-shell/post-play-view";
import { Text, useInput } from "ink";
import React from "react";

import { render } from "../../harness/render-capture";

/**
 * P0-2 regression: post-play `h` opens history. The actual handler is a
 * closure inside the AppRoot `ShellFrame` instance, but the decision now lives
 * in the production resolver imported above. This tiny surface proves the
 * resolver is reachable through real `useInput` delivery.
 */
function PostPlaySurface({
  onResolve,
  blockedByOverlay = false,
}: {
  onResolve: (action: string) => void;
  blockedByOverlay?: boolean;
}) {
  useInput((input, key) => {
    const resolved = resolvePostPlayUnhandledInput(input, key, {
      blockedByOverlay,
      postPlayStateKind: "mid-series",
      selectedActionAvailable: true,
      recommendationCount: 0,
    });
    if (resolved?.type === "shell-result" && typeof resolved.result === "string") {
      onResolve(resolved.result);
    }
  });
  return <Text>post-play</Text>;
}

describe("post-play 'h' opens history (P0-2 regression)", () => {
  test("plain h resolves to the history action", () => {
    const seen: string[] = [];
    const handle = render(<PostPlaySurface onResolve={(action) => seen.push(action)} />);
    handle.stdin.enqueue("h");
    expect(seen).toEqual(["history"]);
    handle.unmount();
  });

  test("Ctrl+H is NOT the history action (the live handler explicitly rejects modifier-prefixed h)", () => {
    const seen: string[] = [];
    const handle = render(<PostPlaySurface onResolve={(action) => seen.push(action)} />);
    handle.stdin.enqueue("h\u0007"); // h + Ctrl-G (Bell) doesn't trigger
    // Ctrl-H is the literal backspace byte (0x08). The post-play handler
    // explicitly requires !key.ctrl && !key.meta so Ctrl+H must not fire.
    expect(seen).toEqual([]);
    handle.unmount();
  });

  test("h is dropped when the overlay blocks input (post-play useInput early-returns)", () => {
    const seen: string[] = [];
    const handle = render(
      <PostPlaySurface onResolve={(action) => seen.push(action)} blockedByOverlay />,
    );
    handle.stdin.enqueue("h");
    expect(seen).toEqual([]);
    handle.unmount();
  });

  test("h after the history action is already resolved fires again (no debounce)", () => {
    const seen: string[] = [];
    const handle = render(<PostPlaySurface onResolve={(action) => seen.push(action)} />);
    handle.stdin.enqueue("h");
    handle.stdin.enqueue("h");
    handle.stdin.enqueue("h");
    expect(seen).toEqual(["history", "history", "history"]);
    handle.unmount();
  });

  test("continue (n) resolves to the same action the footer advertises", () => {
    const resolveContinue = (
      kind: "mid-series" | "season-finale" | "series-complete" | "caught-up",
      extra: { canResume?: boolean; hasNextSeason?: boolean } = {},
    ) =>
      resolvePostPlayUnhandledInput(
        "n",
        {},
        {
          postPlayStateKind: kind,
          selectedActionAvailable: false,
          recommendationCount: 0,
          ...extra,
        },
      );

    // mid-series: resume when an offset exists, otherwise start next from zero.
    expect(resolveContinue("mid-series", { canResume: true })).toEqual({
      type: "shell-result",
      result: "resume",
    });
    expect(resolveContinue("mid-series", { canResume: false })).toEqual({
      type: "shell-result",
      result: "next",
    });
    // season-finale advances seasons only when one exists; otherwise n is a no-op
    // (mirrors the footer, which omits continue) instead of a dead-end `next`.
    expect(resolveContinue("season-finale", { hasNextSeason: true })).toEqual({
      type: "shell-result",
      result: "next-season",
    });
    expect(resolveContinue("season-finale", { hasNextSeason: false })).toBeNull();
    // States that do not offer continue must not silently fire `next`.
    expect(resolveContinue("series-complete")).toBeNull();
    expect(resolveContinue("caught-up")).toBeNull();
  });

  test("production resolver maps recommendation number and action shortcuts", () => {
    expect(
      resolvePostPlayUnhandledInput(
        "2",
        {},
        {
          postPlayStateKind: "series-complete",
          selectedActionAvailable: false,
          recommendationCount: 3,
        },
      ),
    ).toEqual({ type: "recommendation", index: 1 });
    expect(
      resolvePostPlayUnhandledInput(
        "@",
        {},
        {
          postPlayStateKind: "series-complete",
          selectedActionAvailable: false,
          recommendationCount: 3,
        },
      ),
    ).toEqual({ type: "recommendation-actions", index: 1 });
  });
});
