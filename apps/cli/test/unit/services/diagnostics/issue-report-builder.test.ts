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
    expect(draft.body).toContain("Provider failed for https://cdn.example/video.m3u8?token=");
    expect(draft.body).not.toContain("secret");
    expect(draft.body).not.toContain(process.env.HOME ?? "__missing_home__");
    expect(draft.body).toContain("kunai-diagnostics-report.json");
    expect(draft.issueUrl).toStartWith("https://github.com/example/kunai/issues/new?");
    expect(draft.issueUrl).toContain("Provider+failed");
  });
});
