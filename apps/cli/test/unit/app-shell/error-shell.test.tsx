import { describe, expect, test } from "bun:test";

import { ErrorShell } from "@/app-shell/root-status-shells";
import type { ErrorScenario } from "@/domain/playback/playback-problem";
import React from "react";

import { captureFrame, render } from "../../harness/render-capture";

describe("ErrorShell", () => {
  test("renders provider-timeout copy with retry and dismiss hints", () => {
    const scenario: ErrorScenario = {
      kind: "provider-timeout",
      providerName: "VidKing",
      elapsedSec: 30,
    };
    const frame = captureFrame(
      <ErrorShell message="ignored" scenario={scenario} onResolve={() => {}} onRetry={() => {}} />,
      { columns: 100 },
    );
    expect(frame).toContain("Playback failed");
    expect(frame).toContain("timed out after");
    expect(frame).toContain("VidKing");
    expect(frame).toContain("r retry");
    expect(frame).toContain("Enter / Esc dismiss");
  });

  test("renders provider-empty copy with retry", () => {
    const scenario: ErrorScenario = {
      kind: "provider-empty",
      title: "Severance",
      providerName: "Miruro",
    };
    const frame = captureFrame(
      <ErrorShell message="ignored" scenario={scenario} onResolve={() => {}} onRetry={() => {}} />,
      { columns: 100 },
    );
    expect(frame).toContain("Miruro returned no playable stream");
    expect(frame).toContain("r retry");
    expect(frame).toContain("/fallback");
  });

  test("renders user-cancelled without retry binding", () => {
    const scenario: ErrorScenario = { kind: "user-cancelled" };
    const frame = captureFrame(
      <ErrorShell message="ignored" scenario={scenario} onResolve={() => {}} />,
      { columns: 100 },
    );
    expect(frame).toContain("resolution cancelled");
    expect(frame).toContain("Enter / Esc to continue");
    expect(frame).not.toMatch(/\br retry\b/);
  });

  test("r triggers onRetry when provided; Enter dismisses", () => {
    const retries: string[] = [];
    const resolves: string[] = [];
    const handle = render(
      <ErrorShell
        message="boom"
        scenario={{ kind: "stream-broken", attempt: 1, maxAttempts: 3 }}
        onResolve={() => resolves.push("enter")}
        onRetry={() => retries.push("r")}
      />,
      { columns: 100 },
    );

    handle.stdin.enqueue("r");
    expect(retries).toEqual(["r"]);
    expect(resolves).toEqual([]);

    handle.stdin.enqueue("\r");
    expect(resolves).toEqual(["enter"]);
    handle.unmount();
  });

  test("r is ignored when onRetry is omitted", () => {
    const retries: string[] = [];
    const resolves: string[] = [];
    const handle = render(
      <ErrorShell
        message="cancelled"
        scenario={{ kind: "user-cancelled" }}
        onResolve={() => resolves.push("enter")}
      />,
      { columns: 100 },
    );

    handle.stdin.enqueue("r");
    expect(retries).toEqual([]);

    handle.stdin.enqueue("\r"); // Enter
    expect(resolves).toEqual(["enter"]);
    handle.unmount();
  });
});
