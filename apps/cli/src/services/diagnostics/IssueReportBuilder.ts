import type { DiagnosticsSupportBundle } from "./support-bundle";

export type IssueReportDraft = {
  readonly title: string;
  readonly body: string;
  readonly diagnosticsPath?: string;
  readonly issueUrl: string;
};

export function buildIssueReportDraft(input: {
  readonly bundle: DiagnosticsSupportBundle;
  readonly diagnosticsPath?: string;
  readonly repositoryUrl?: string;
}): IssueReportDraft {
  const repositoryUrl = input.repositoryUrl ?? "https://github.com/kitsunekode/kunai";
  const title = buildIssueTitle(input.bundle);
  const body = buildIssueBody(input.bundle, input.diagnosticsPath);
  const params = new URLSearchParams({ title, body });

  return {
    title,
    body,
    diagnosticsPath: input.diagnosticsPath,
    issueUrl: `${repositoryUrl.replace(/\/$/, "")}/issues/new?${params.toString()}`,
  };
}

function buildIssueTitle(bundle: DiagnosticsSupportBundle): string {
  const firstIssueSection = Object.entries(bundle.sections).find(
    ([, section]) => section.tone === "issue" || section.tone === "warning",
  );
  const area = firstIssueSection?.[0] ?? "runtime";
  return `[${area}] ${truncate(singleLine(bundle.summary.headline), 90)}`;
}

function buildIssueBody(bundle: DiagnosticsSupportBundle, diagnosticsPath?: string): string {
  const sectionLines = Object.entries(bundle.sections).map(
    ([name, section]) =>
      `- ${name}: ${section.tone}, ${section.eventCount} event(s), latest: ${
        section.latestMessage ?? "none"
      }`,
  );
  const latestEvents = bundle.events.slice(-8).map((event) => {
    const provider = event.providerId ? ` provider=${event.providerId}` : "";
    return `- ${new Date(event.timestamp).toISOString()} ${event.level}/${event.category} ${
      event.operation
    }${provider}: ${event.message}`;
  });

  return [
    "## Summary",
    bundle.summary.headline,
    "",
    "## Diagnostics Sections",
    sectionLines.length ? sectionLines.join("\n") : "- No diagnostics sections recorded.",
    "",
    "## Runtime",
    `- App: ${bundle.app.version}`,
    `- Debug: ${String(bundle.app.debug)}`,
    `- Platform: ${bundle.runtime.platform} ${bundle.runtime.arch}`,
    `- Bun: ${bundle.runtime.bunVersion}`,
    diagnosticsPath ? `- Exported bundle: ${diagnosticsPath}` : "- Exported bundle: not attached",
    "",
    "## Latest Events",
    latestEvents.length ? latestEvents.join("\n") : "- No events recorded.",
    "",
    "## Notes",
    "The diagnostics summary above is redacted. Attach the exported JSON bundle if it is safe for your report.",
  ].join("\n");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
