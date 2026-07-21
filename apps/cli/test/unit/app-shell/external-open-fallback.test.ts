import { describe, expect, test } from "bun:test";

import {
  buildExternalOpenFallback,
  formatExternalOpenFallbackNote,
} from "@/app-shell/external-open-fallback";
import type { ExternalOpenResult } from "@/infra/os/external-open";

function failure(
  overrides: Partial<Extract<ExternalOpenResult, { ok: false }>> &
    Pick<Extract<ExternalOpenResult, { ok: false }>, "reason" | "target">,
): Extract<ExternalOpenResult, { ok: false }> {
  return { ok: false, ...overrides };
}

describe("external-open-fallback", () => {
  test("URL failure surfaces the complete URL as copyable", () => {
    const result = failure({
      reason: "opener-not-found",
      target: { kind: "url", url: "https://github.com/KitsuneKode/kunai/releases/tag/v0.3.0" },
    });

    const fallback = buildExternalOpenFallback({ result });
    expect(fallback.copyTargets).toEqual([
      "https://github.com/KitsuneKode/kunai/releases/tag/v0.3.0",
    ]);
    expect(fallback.summary).toContain("Could not open");
    expect(fallback.explanation).toMatch(/opener|xdg-open|open|cmd/i);
    expect(formatExternalOpenFallbackNote(fallback)).toContain(
      "https://github.com/KitsuneKode/kunai/releases/tag/v0.3.0",
    );
  });

  test("folder reveal failure surfaces the original path", () => {
    const path = "/home/user/Videos/Kunai/show.mkv";
    const result = failure({
      reason: "non-zero-exit",
      target: { kind: "path", path },
      detail: "exit 1",
    });

    const fallback = buildExternalOpenFallback({ result });
    expect(fallback.copyTargets).toEqual([path]);
    expect(formatExternalOpenFallbackNote(fallback)).toContain(path);
  });

  test("issue reporting shows issue URL and absolute bundle path", () => {
    const issueUrl = "https://github.com/kitsunekode/kunai/issues/new/choose";
    const bundlePath = "/tmp/kunai-diagnostics-report-abc.json";
    const result = failure({
      reason: "spawn-failed",
      target: { kind: "url", url: issueUrl },
      detail: "ENOENT",
    });

    const fallback = buildExternalOpenFallback({ result, bundlePath });
    expect(fallback.copyTargets).toEqual([issueUrl, bundlePath]);
    const note = formatExternalOpenFallbackNote(fallback);
    expect(note).toContain(issueUrl);
    expect(note).toContain(bundlePath);
  });

  test("disabled failure explains the env gate", () => {
    const fallback = buildExternalOpenFallback({
      result: failure({
        reason: "disabled",
        target: { kind: "url", url: "https://example.com/docs" },
      }),
    });
    expect(fallback.explanation).toContain("KUNAI_DISABLE_EXTERNAL_URL");
  });
});
