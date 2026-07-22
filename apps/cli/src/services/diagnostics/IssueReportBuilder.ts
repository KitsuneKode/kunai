import type { DiagnosticsSupportBundle } from "./support-bundle";

export type IssueReportDraft = {
  readonly title: string;
  readonly body: string;
  readonly diagnosticsPath?: string;
  readonly issueUrl: string;
};

/**
 * GitHub caps issue-prefill URLs; past roughly 8 KB the request is rejected and
 * the user lands on an error page instead of a filled form. Budget the whole URL
 * and shrink the diagnostics field (the only unbounded part) to fit.
 */
const MAX_ISSUE_URL_LENGTH = 7_500;

/** Field ids in `.github/ISSUE_TEMPLATE/bug_report.yml`. */
const BUG_REPORT_TEMPLATE = "bug_report.yml";

/**
 * Dropdown options must match `bug_report.yml` exactly or GitHub silently drops
 * the prefill for that field.
 */
const INSTALL_METHOD_OPTIONS: Readonly<Record<string, string>> = {
  binary: "Binary (install.sh / install.ps1)",
  "npm-global": "npm global (npm i -g)",
  "bun-global": "bun global (bun i -g)",
  source: "Source checkout (bun run link:global)",
  unknown: "Not sure",
};

export function buildIssueReportDraft(input: {
  readonly bundle: DiagnosticsSupportBundle;
  readonly diagnosticsPath?: string;
  readonly repositoryUrl?: string;
  readonly installMethod?: string;
}): IssueReportDraft {
  const repositoryUrl = (input.repositoryUrl ?? "https://github.com/kitsunekode/kunai").replace(
    /\/$/,
    "",
  );
  const title = buildIssueTitle(input.bundle);
  const body = buildIssueBody(input.bundle, input.diagnosticsPath);

  return {
    title,
    body,
    diagnosticsPath: input.diagnosticsPath,
    issueUrl: buildIssueUrl({
      repositoryUrl,
      title,
      bundle: input.bundle,
      diagnosticsPath: input.diagnosticsPath,
      installMethod: input.installMethod,
    }),
  };
}

/**
 * Build a URL that actually prefills the bug-report form.
 *
 * The previous `/issues/new?title=&body=` form could never work: this repo sets
 * `blank_issues_enabled: false` and uses issue *forms*, so GitHub redirects that
 * URL to the template chooser and discards both params. Every diagnostic we had
 * carefully assembled was dropped on the way to the browser.
 *
 * Issue forms prefill from query keys named after each field's `id`, and only
 * when `template=` names the form.
 */
function buildIssueUrl(input: {
  readonly repositoryUrl: string;
  readonly title: string;
  readonly bundle: DiagnosticsSupportBundle;
  readonly diagnosticsPath?: string;
  readonly installMethod?: string;
}): string {
  const { bundle } = input;
  const base = `${input.repositoryUrl}/issues/new`;

  const fields: Record<string, string> = {
    template: BUG_REPORT_TEMPLATE,
    title: input.title,
    description: bundle.summary.headline,
    os: `${bundle.runtime.platform} ${bundle.runtime.arch}`,
    version: bundle.app.version,
  };

  const terminal = bundle.runtime.terminal?.trim();
  if (terminal) fields.terminal = terminal;

  const installMethod = input.installMethod
    ? INSTALL_METHOD_OPTIONS[input.installMethod]
    : undefined;
  if (installMethod) fields["install-method"] = installMethod;

  // `steps` is required by the form and only the reporter knows them, so seed a
  // visible prompt rather than leaving a blank required field.
  fields.steps = "1. \n2. \n3. \n\n(Please replace with the exact steps.)";

  const staticLength = new URL(`${base}?${new URLSearchParams(fields).toString()}`).toString()
    .length;
  const diagnostics = buildDiagnosticsField(bundle, input.diagnosticsPath);
  const budget = MAX_ISSUE_URL_LENGTH - staticLength;
  const fitted = fitEncoded(diagnostics, budget);
  if (fitted) fields.diagnostics = fitted;

  return `${base}?${new URLSearchParams(fields).toString()}`;
}

/** Longest prefix of `value` whose URL-encoded form fits `budget` bytes. */
function fitEncoded(value: string, budget: number): string {
  if (budget <= 0) return "";
  if (encodeURIComponent(value).length <= budget) return value;

  const suffix = "\n…truncated; attach the exported bundle for the full report.";
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encodeURIComponent(value.slice(0, mid) + suffix).length <= budget) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? value.slice(0, low) + suffix : "";
}

function buildIssueTitle(bundle: DiagnosticsSupportBundle): string {
  const firstIssueSection = Object.entries(bundle.sections).find(
    ([, section]) => section.tone === "issue" || section.tone === "warning",
  );
  const area = firstIssueSection?.[0] ?? "runtime";
  return `[${area}] ${truncate(singleLine(bundle.summary.headline), 90)}`;
}

/** The prefill for the form's `diagnostics` textarea (rendered as plain text). */
function buildDiagnosticsField(bundle: DiagnosticsSupportBundle, diagnosticsPath?: string): string {
  const sectionLines = Object.entries(bundle.sections).map(
    ([name, section]) =>
      `- ${name}: ${section.tone}, ${section.eventCount} event(s), latest: ${
        section.latestMessage ?? "none"
      }`,
  );
  const latestEvents = bundle.events.slice(-8).map(formatEvent);

  return [
    `Bun: ${bundle.runtime.bunVersion}  ·  debug: ${String(bundle.app.debug)}`,
    diagnosticsPath ? `Exported bundle: ${diagnosticsPath}` : "Exported bundle: not attached",
    "",
    "Sections:",
    sectionLines.length ? sectionLines.join("\n") : "- none recorded",
    "",
    "Latest events:",
    latestEvents.length ? latestEvents.join("\n") : "- none recorded",
  ].join("\n");
}

/** Markdown body, used for the copy/paste fallback when the browser cannot open. */
function buildIssueBody(bundle: DiagnosticsSupportBundle, diagnosticsPath?: string): string {
  const sectionLines = Object.entries(bundle.sections).map(
    ([name, section]) =>
      `- ${name}: ${section.tone}, ${section.eventCount} event(s), latest: ${
        section.latestMessage ?? "none"
      }`,
  );
  const latestEvents = bundle.events.slice(-8).map((event) => `- ${formatEvent(event)}`);

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
    `- Terminal: ${bundle.runtime.terminal ?? "unknown"}`,
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

function formatEvent(event: DiagnosticsSupportBundle["events"][number]): string {
  const provider = event.providerId ? ` provider=${event.providerId}` : "";
  return `${new Date(event.timestamp).toISOString()} ${event.level}/${event.category} ${
    event.operation
  }${provider}: ${event.message}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
