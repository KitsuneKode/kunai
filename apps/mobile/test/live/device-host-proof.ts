export type MobileDeviceEvidence = {
  readonly schemaVersion: 2;
  readonly kunaiVersion: string;
  readonly platform: "android" | "ios";
  readonly osVersion: string;
  readonly terminal: "termux" | "a-shell-mini";
  readonly terminalVersion: string;
  readonly runtimeVersion: string;
  readonly architecture: "arm64" | "x64";
  readonly player: "vlc";
  readonly playerVersion: string;
  readonly deviceClass: "physical";
  readonly artifactTarget: "android-termux-node" | "ios-ashell";
  readonly artifactSetSha256: string;
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
  "kunaiVersion",
  "platform",
  "osVersion",
  "terminal",
  "terminalVersion",
  "runtimeVersion",
  "architecture",
  "player",
  "playerVersion",
  "deviceClass",
  "artifactTarget",
  "artifactSetSha256",
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
    throw new Error("Mobile device evidence must contain the exact fields for schema 2");
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

function assertVersionString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/u.test(value)) {
    throw new Error(`Mobile device evidence has an invalid ${field}`);
  }
}

export function validateMobileDeviceEvidence(value: unknown): MobileDeviceEvidence {
  if (!isRecord(value)) throw new Error("Mobile device evidence must be a JSON object");
  assertExactFields(value);
  assertRedactedStrings(value);

  if (value.schemaVersion !== 2) {
    throw new Error("Mobile device evidence schemaVersion must be 2");
  }
  assertVersionString(value.kunaiVersion, "kunaiVersion");
  assertEnum(value.platform, "platform", ["android", "ios"]);
  if (
    typeof value.osVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/u.test(value.osVersion)
  ) {
    throw new Error("Mobile device evidence has an invalid osVersion");
  }
  assertEnum(value.terminal, "terminal", ["termux", "a-shell-mini"]);
  assertVersionString(value.terminalVersion, "terminalVersion");
  assertVersionString(value.runtimeVersion, "runtimeVersion");
  assertEnum(value.architecture, "architecture", ["arm64", "x64"]);
  assertEnum(value.player, "player", ["vlc"]);
  assertVersionString(value.playerVersion, "playerVersion");
  assertEnum(value.deviceClass, "deviceClass", ["physical"]);
  assertEnum(value.artifactTarget, "artifactTarget", ["android-termux-node", "ios-ashell"]);
  if (
    typeof value.artifactSetSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.artifactSetSha256)
  ) {
    throw new Error("Mobile device evidence has an invalid artifactSetSha256");
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
  if (
    (value.platform === "android" && value.artifactTarget !== "android-termux-node") ||
    (value.platform === "ios" && value.artifactTarget !== "ios-ashell")
  ) {
    throw new Error("Mobile device evidence has an unsupported platform/artifact target pair");
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

export function validateMobileEvidenceMatrix(
  metadataValue: unknown,
  evidenceValues: readonly unknown[],
): readonly MobileDeviceEvidence[] {
  if (!isRecord(metadataValue) || metadataValue.schemaVersion !== 2) {
    throw new Error("Mobile build metadata schemaVersion must be 2");
  }
  assertVersionString(metadataValue.version, "build metadata version");
  if (!Array.isArray(metadataValue.artifactSets)) {
    throw new Error("Mobile build metadata has invalid artifact sets");
  }

  const evidence = evidenceValues.map(validateMobileDeviceEvidence);
  const android = evidence.filter((row) => row.platform === "android");
  const ios = evidence.filter((row) => row.platform === "ios");
  if (evidence.length !== 2 || android.length !== 1 || ios.length !== 1) {
    throw new Error("Mobile qualification requires exactly one Android and one iOS evidence row");
  }
  const androidEvidence = android[0];
  const iosEvidence = ios[0];
  if (!androidEvidence || !iosEvidence) {
    throw new Error("Mobile qualification requires exactly one Android and one iOS evidence row");
  }
  if (androidEvidence.architecture !== "arm64") {
    throw new Error("Mobile qualification requires a physical Android ARM64 device");
  }

  for (const row of evidence) {
    if (!mobileDeviceEvidencePassed(row)) {
      throw new Error("Mobile device host proof did not pass every required observation");
    }
    if (row.kunaiVersion !== metadataValue.version) {
      throw new Error("Mobile device evidence does not match the Kunai version");
    }
    const matches = metadataValue.artifactSets.filter(
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && candidate.target === row.artifactTarget,
    );
    if (
      matches.length !== 1 ||
      typeof matches[0]?.sha256 !== "string" ||
      matches[0].sha256 !== row.artifactSetSha256
    ) {
      throw new Error("Mobile device evidence does not match the generated artifact set");
    }
  }

  return [androidEvidence, iosEvidence];
}

function result(value: boolean): "passed" | "failed" {
  return value ? "passed" : "failed";
}

export function formatMobileDeviceEvidenceRow(evidence: MobileDeviceEvidence): string {
  return [
    evidence.platform,
    evidence.osVersion,
    `${evidence.terminal} ${evidence.terminalVersion}`,
    `runtime=${evidence.runtimeVersion}`,
    evidence.architecture,
    `${evidence.player} ${evidence.playerVersion}`,
    `kunai=${evidence.kunaiVersion}`,
    `target=${evidence.artifactTarget}`,
    `sha256=${evidence.artifactSetSha256.slice(0, 12)}`,
    `input=${evidence.terminalInput}`,
    `http=${evidence.http}`,
    `state=${evidence.stateRecovery}`,
    `cancel=${evidence.cancellation}`,
    `handoff=${result(evidence.handoffAccepted)}`,
    `playback=${result(evidence.playbackBegan)}`,
    `recorded=${evidence.recordedAt}`,
  ].join(" | ");
}

async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size > MAX_EVIDENCE_BYTES) {
    throw new Error("Mobile qualification input is missing or too large");
  }
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("Mobile qualification input is not valid JSON");
  }
}

async function main(argv: readonly string[]): Promise<void> {
  let metadataPath: string | undefined;
  const evidencePaths: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || (flag !== "--metadata" && flag !== "--evidence")) {
      throw new Error(
        "Usage: test:live:mobile-host-proof -- --metadata <mobile-build-meta.json> --evidence <android.json> --evidence <ios.json>",
      );
    }
    if (flag === "--metadata") {
      if (metadataPath) throw new Error("Mobile qualification accepts one metadata file");
      metadataPath = value;
    } else {
      evidencePaths.push(value);
    }
  }
  if (!metadataPath || evidencePaths.length !== 2) {
    throw new Error(
      "Usage: test:live:mobile-host-proof -- --metadata <mobile-build-meta.json> --evidence <android.json> --evidence <ios.json>",
    );
  }
  const evidence = validateMobileEvidenceMatrix(
    await readJson(metadataPath),
    await Promise.all(evidencePaths.map(readJson)),
  );
  for (const row of evidence) {
    console.log(formatMobileDeviceEvidenceRow(row));
  }
  console.log("Mobile physical-device qualification matrix passed.");
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
