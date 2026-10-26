import { describe, expect, spyOn, test } from "bun:test";

import { MouseDispatcher, MouseDispatchProvider } from "@/app-shell/mouse/MouseRegions";
import { ErrorShell } from "@/app-shell/root-status-shells";
import React, { act } from "react";

import { CAPTURE_WIDTHS, captureFrame, render } from "../../harness/render-capture";
import { renderedWidth } from "../../support/rendered-width";

const props = {
  message: "An unknown error occurred",
  scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 } as const,
  waterfall: {
    title: "Source attempts",
    truncated: false,
    rows: [
      { label: "search", detail: "0.4s", status: "succeeded" as const },
      { label: "resolve", detail: "timed out", status: "failed" as const },
    ],
  },
  onResolve: () => {},
  onRetry: () => {},
};

describe("ErrorShell", () => {
  test("renders the headline, scenario detail and waterfall", () => {
    const frame = captureFrame(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
    expect(frame).toContain("Playback failed");
    expect(frame).toContain("timed out after 12s");
    expect(frame).toContain("allmanga");
    expect(frame).toContain("Source attempts");
    expect(frame).toContain("resolve");
    expect(frame).toContain("r retry");
  });

  test("falls back to the raw message with no scenario", () => {
    const frame = captureFrame(<ErrorShell message="boom" onResolve={() => {}} />, {
      columns: CAPTURE_WIDTHS.medium,
    });
    expect(frame).toContain("boom");
  });

  test("failure recovery stays steady without decorative animation timers", () => {
    const previous = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "0";
    const intervals = spyOn(globalThis, "setInterval");
    const handle = render(<ErrorShell {...props} />);
    try {
      expect(handle.lastFrame()).toContain("Playback failed");
      expect(intervals.mock.calls).toHaveLength(0);
    } finally {
      handle.unmount();
      intervals.mockRestore();
      if (previous === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = previous;
    }
  });

  test("renders at every canonical width without exceeding the terminal", () => {
    for (const columns of Object.values(CAPTURE_WIDTHS)) {
      const frame = captureFrame(<ErrorShell {...props} />, { columns });
      expect(frame).toContain("Playback failed");
      for (const line of frame.split("\n")) {
        // Display columns, not character count — Ink's inline colour codes are
        // not glyphs, and a wide glyph is not one column.
        expect(renderedWidth(line)).toBeLessThanOrEqual(columns);
      }
    }
  });

  // #465: the cell buffer used to count code points as columns, so an
  // unwrapped CJK row (waterfall entries are never wrapped) rendered nearly
  // twice its allotted width and petal lanes measured where text ended in the
  // wrong place.
  test("an unwrapped CJK waterfall row stays inside the panel width", () => {
    const frame = captureFrame(
      <ErrorShell
        {...props}
        waterfall={{
          title: "ソースの試行",
          truncated: false,
          rows: [
            {
              label: "ストリーム解決プロバイダーの直接接続を試行しています",
              detail: "タイムアウトしました",
              status: "failed" as const,
            },
          ],
        }}
      />,
      { columns: CAPTURE_WIDTHS.narrow },
    );
    expect(frame).toContain("Playback failed");
    for (const line of frame.split("\n")) {
      expect(renderedWidth(line)).toBeLessThanOrEqual(CAPTURE_WIDTHS.narrow);
    }
  });

  // #465: the sentence that says what failed used to clip mid-word with no
  // ellipsis. It now wraps inside the panel, and only a message longer than
  // the row budget shows the cut — with a visible marker.
  test("a long failure message wraps instead of clipping silently", () => {
    const message =
      "The upstream provider rejected the signed playback URL because the session " +
      "token expired; refresh it under /settings or pick another provider";
    const frame = captureFrame(<ErrorShell message={message} onResolve={() => {}} />, {
      columns: CAPTURE_WIDTHS.medium,
    });
    expect(frame).toContain("The upstream provider rejected");
    expect(frame).toContain("pick another provider");
  });

  test("r triggers retry", () => {
    let retried = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onRetry={() => {
          retried += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("r");
      expect(retried).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("Enter resolves", () => {
    let resolved = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onResolve={() => {
          resolved += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("\r");
      expect(resolved).toBe(1);
    } finally {
      handle.unmount();
    }
  });
});

test("failure surface exposes provider recovery with a working shortcut", () => {
  const hits: string[] = [];
  const handle = render(
    <ErrorShell
      message="Provider did not return a playable stream"
      onResolve={() => hits.push("dismiss")}
      onProviders={() => hits.push("providers")}
    />,
  );
  try {
    expect(handle.lastFrame()).toContain("[p] providers");
    handle.stdin.enqueue("p");
    expect(hits).toEqual(["providers"]);
  } finally {
    handle.unmount();
  }
});

test("provider recovery button activates through the real Ink mouse region", () => {
  const dispatcher = new MouseDispatcher();
  let opens = 0;
  const handle = render(
    <MouseDispatchProvider dispatcher={dispatcher}>
      <ErrorShell
        message="No stream from this provider"
        onResolve={() => {}}
        onProviders={() => {
          opens++;
        }}
      />
    </MouseDispatchProvider>,
  );
  try {
    const region = dispatcher
      .debugRegions()
      .find((candidate) => candidate.id === "playback-error:providers");
    expect(region).toBeDefined();
    if (!region) throw new Error("Provider button has no hit target");
    const event = {
      x: region.rect.x,
      y: region.rect.y,
      button: "left" as const,
      ctrl: false,
      shift: false,
      alt: false,
    };
    act(() => {
      dispatcher.dispatch({ ...event, kind: "press" });
    });
    act(() => {
      dispatcher.dispatch({ ...event, kind: "release" });
    });
    expect(opens).toBe(1);
  } finally {
    handle.unmount();
  }
});
