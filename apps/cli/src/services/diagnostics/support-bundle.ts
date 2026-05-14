import type { DiagnosticEvent } from "./diagnostic-event";
import { redactDiagnosticValue } from "./redaction";

export type DiagnosticsSupportBundle = {
  readonly exportedAt: string;
  readonly app: {
    readonly version: string;
    readonly debug: boolean;
  };
  readonly runtime: {
    readonly platform: string;
    readonly arch: string;
    readonly bunVersion: string;
  };
  readonly capabilities: Record<string, unknown>;
  readonly eventCount: number;
  readonly events: readonly DiagnosticEvent[];
};

export type BuildDiagnosticsSupportBundleInput = {
  readonly appVersion: string;
  readonly debug: boolean;
  readonly capabilities?: Record<string, unknown> | null;
  readonly events: readonly DiagnosticEvent[];
  readonly now?: () => Date;
};

export function buildDiagnosticsSupportBundle(
  input: BuildDiagnosticsSupportBundleInput,
): DiagnosticsSupportBundle {
  const now = input.now ?? (() => new Date());
  const redactionOptions = { homeDir: process.env.HOME };
  const events = redactDiagnosticValue(input.events, redactionOptions) as DiagnosticEvent[];
  const capabilities = redactDiagnosticValue(input.capabilities ?? {}, redactionOptions) as Record<
    string,
    unknown
  >;

  return {
    exportedAt: now().toISOString(),
    app: {
      version: input.appVersion,
      debug: input.debug,
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
    },
    capabilities,
    eventCount: events.length,
    events,
  };
}
