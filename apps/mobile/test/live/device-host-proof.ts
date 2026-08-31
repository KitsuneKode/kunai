export type MobileDeviceEvidence = {
  readonly schemaVersion: 1;
  readonly platform: "android" | "ios";
  readonly osVersion: string;
  readonly terminal: "termux" | "a-shell-mini";
  readonly architecture: "arm64" | "x64";
  readonly player: "vlc";
  readonly artifactSha256: string;
  readonly terminalInput: "passed" | "failed";
  readonly http: "passed" | "failed";
  readonly stateRecovery: "passed" | "failed";
  readonly cancellation: "passed" | "failed";
  readonly handoffAccepted: boolean;
  readonly playbackBegan: boolean;
  readonly recordedAt: string;
};

const EVIDENCE_FIELDS = [
  "schemaVersion",
  "platform",
  "osVersion",
  "terminal",
  "architecture",
  "player",
  "artifactSha256",
  "terminalInput",
  "http",
  "stateRecovery",
  "cancellation",
  "handoffAccepted",
  "playbackBegan",
  "recordedAt",
] as const satisfies readonly (keyof MobileDeviceEvidence)[];

const EVIDENCE_FIELD_SET = new Set<string>(EVIDENCE_FIELDS);
const RESULT_FIELDS = ["terminalInput", "http", "stateRecovery", "cancellation"] as const;
const MAX_EVIDENCE_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRedactedStrings(value: Record<string, unknown>): void {
  for (const field of EVIDENCE_FIELDS) {
    const item = value[field];
    if (typeof item !== "string") continue;
    if (
      [...item].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
      }) ||
      /(?:https?|file|vlc(?:-x-callback)?):\/\//iu.test(item) ||
      /(?:^|\s)www\./iu.test(item) ||
      /[?&]/u.test(item)
    ) {
      throw new Error("Mobile device evidence must contain only redacted strings");
    }
  }
}

function assertExactFields(value: Record<string, unknown>): void {
  const keys = Object.keys(value);
  const sensitive = keys.find((key) => /authorization|cookie|password|secret|token/iu.test(key));
  if (sensitive) throw new Error("Mobile device evidence contains a sensitive field");
  if (keys.length !== EVIDENCE_FIELDS.length || keys.some((key) => !EVIDENCE_FIELD_SET.has(key))) {
    throw new Error("Mobile device evidence must contain the exact fields for schema 1");
  }
}

function assertEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Mobile device evidence has an invalid ${field}`);
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Mobile device evidence has an invalid ${field}`);
  }
}

function assertRecordedAt(value: unknown): asserts value is string {
  if (typeof value !== "string")
    throw new Error("Mobile device evidence has an invalid recordedAt");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("Mobile device evidence has an invalid recordedAt");
  }
}

export function validateMobileDeviceEvidence(value: unknown): MobileDeviceEvidence {
  if (!isRecord(value)) throw new Error("Mobile device evidence must be a JSON object");
  assertExactFields(value);
  assertRedactedStrings(value);

  if (value.schemaVersion !== 1) {
    throw new Error("Mobile device evidence schemaVersion must be 1");
  }
  assertEnum(value.platform, "platform", ["android", "ios"]);
  if (
    typeof value.osVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/u.test(value.osVersion)
  ) {
    throw new Error("Mobile device evidence has an invalid osVersion");
  }
  assertEnum(value.terminal, "terminal", ["termux", "a-shell-mini"]);
  assertEnum(value.architecture, "architecture", ["arm64", "x64"]);
  assertEnum(value.player, "player", ["vlc"]);
  if (typeof value.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.artifactSha256)) {
    throw new Error("Mobile device evidence has an invalid artifactSha256");
  }
  for (const field of RESULT_FIELDS) assertEnum(value[field], field, ["passed", "failed"]);
  assertBoolean(value.handoffAccepted, "handoffAccepted");
  assertBoolean(value.playbackBegan, "playbackBegan");
  assertRecordedAt(value.recordedAt);

  if (
    (value.platform === "android" && value.terminal !== "termux") ||
    (value.platform === "ios" && value.terminal !== "a-shell-mini")
  ) {
    throw new Error("Mobile device evidence has an unsupported platform/terminal pair");
  }
  if (value.platform === "ios" && value.architecture !== "arm64") {
    throw new Error("iOS physical evidence requires an arm64 device");
  }

  return value as MobileDeviceEvidence;
}

export function mobileDeviceEvidencePassed(evidence: MobileDeviceEvidence): boolean {
  return (
    RESULT_FIELDS.every((field) => evidence[field] === "passed") &&
    evidence.handoffAccepted &&
    evidence.playbackBegan
  );
}

function result(value: boolean): "passed" | "failed" {
  return value ? "passed" : "failed";
}

export function formatMobileDeviceEvidenceRow(evidence: MobileDeviceEvidence): string {
  return [
    evidence.platform,
    evidence.osVersion,
    evidence.terminal,
    evidence.architecture,
    evidence.player,
    `sha256=${evidence.artifactSha256.slice(0, 12)}`,
    `input=${evidence.terminalInput}`,
    `http=${evidence.http}`,
    `state=${evidence.stateRecovery}`,
    `cancel=${evidence.cancellation}`,
    `handoff=${result(evidence.handoffAccepted)}`,
    `playback=${result(evidence.playbackBegan)}`,
    `recorded=${evidence.recordedAt}`,
  ].join(" | ");
}

async function readEvidence(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size > MAX_EVIDENCE_BYTES) {
    throw new Error("Mobile device evidence file is missing or too large");
  }
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("Mobile device evidence is not valid JSON");
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const evidencePath = argv[1];
  if (argv.length !== 2 || argv[0] !== "--evidence" || !evidencePath) {
    throw new Error("Usage: test:live:mobile-host-proof -- --evidence <redacted-evidence.json>");
  }
  const evidence = validateMobileDeviceEvidence(await readEvidence(evidencePath));
  console.log(formatMobileDeviceEvidenceRow(evidence));
  if (!mobileDeviceEvidencePassed(evidence)) {
    throw new Error("Mobile device host proof did not pass every required observation");
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Mobile device evidence validation failed",
    );
    process.exitCode = 1;
  }
}
