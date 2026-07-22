import { describe, expect, test } from "bun:test";

import { buildIssueReportDraft } from "@/services/diagnostics/IssueReportBuilder";
import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

describe("IssueReportBuilder", () => {
  test("builds a redacted GitHub issue draft from the support bundle", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: Date.parse("2026-05-16T00:00:00.000Z"),
          category: "provider",
          level: "warn",
          operation: "provider.resolve",
          providerId: "vidking",
          message: "Provider failed for https://cdn.example/video.m3u8?token=secret",
          context: { path: `${process.env.HOME ?? "/home/user"}/.config/kunai/config.json` },
        },
      ],
    });

    const draft = buildIssueReportDraft({
      bundle,
      diagnosticsPath: "kunai-diagnostics-report.json",
      repositoryUrl: "https://github.com/example/kunai",
    });

    expect(draft.title).toContain("[provider]");
    expect(draft.body).toContain("Provider failed for https://redacted-host/video.m3u8");
    expect(draft.body).not.toContain("secret");
    expect(draft.body).not.toContain("cdn.example");
    expect(draft.body).not.toContain(process.env.HOME ?? "__missing_home__");
    expect(draft.body).toContain("kunai-diagnostics-report.json");
    expect(draft.issueUrl).toStartWith("https://github.com/example/kunai/issues/new?");
    expect(draft.issueUrl).toContain("Provider+failed");
  });

  function bundleWith(eventCount: number, detailWords = 40) {
    return buildDiagnosticsSupportBundle({
      appVersion: "0.3.0",
      debug: false,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      environment: { terminal: "kitty" },
      events: Array.from({ length: eventCount }, (_, i) => ({
        timestamp: Date.parse("2026-07-22T00:00:00.000Z"),
        category: "provider" as const,
        level: "warn" as const,
        operation: "provider.resolve",
        message: `failure ${i} ${"detail ".repeat(detailWords)}`,
      })),
    });
  }

  // The old URL was `/issues/new?title=&body=`. This repo sets
  // `blank_issues_enabled: false` and uses issue *forms*, so GitHub redirects
  // that to the template chooser and discards both params — every diagnostic
  // was dropped between the CLI and the browser.
  test("targets the bug-report form and prefills its field ids", () => {
    const draft = buildIssueReportDraft({
      bundle: bundleWith(1),
      diagnosticsPath: "report.json",
      repositoryUrl: "https://github.com/example/kunai",
      installMethod: "binary",
    });
    const params = new URL(draft.issueUrl).searchParams;

    expect(params.get("template")).toBe("bug_report.yml");
    expect(params.get("title")).toBe(draft.title);
    expect(params.get("os")).toContain(process.platform);
    expect(params.get("version")).toBe("0.3.0");
    expect(params.get("terminal")).toBe("kitty");
    expect(params.get("diagnostics")).toContain("report.json");
    expect(params.get("steps")).toBeTruthy();
  });

  // A dropdown prefill is dropped silently unless it matches an option string
  // in bug_report.yml exactly.
  test("maps install method onto the exact dropdown option, and omits unknown ones", () => {
    const url = (installMethod: string) =>
      new URL(
        buildIssueReportDraft({ bundle: bundleWith(1), installMethod }).issueUrl,
      ).searchParams.get("install-method");

    expect(url("binary")).toBe("Binary (install.sh / install.ps1)");
    expect(url("npm-global")).toBe("npm global (npm i -g)");
    expect(url("source")).toBe("Source checkout (bun run link:global)");
    expect(url("not-a-method")).toBeNull();
  });

  // GitHub rejects oversized prefill URLs outright, so a chatty session would
  // send the reporter to an error page instead of a filled form.
  test("keeps the URL under GitHub's prefill limit by shrinking diagnostics", () => {
    const draft = buildIssueReportDraft({
      bundle: bundleWith(8, 400),
      diagnosticsPath: "report.json",
      installMethod: "binary",
    });

    expect(draft.issueUrl.length).toBeLessThanOrEqual(7_500);
    expect(new URL(draft.issueUrl).searchParams.get("diagnostics")).toContain("truncated");
    // The untruncated body is still available for the copy/paste fallback.
    expect(draft.body).toContain("## Latest Events");
  });
});
