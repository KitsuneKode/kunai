// Typed evidence-vs-language seam. The two formatters take non-overlapping
// input shapes so mixing a server/source label into language UI is a type
// error, not a convention someone can violate. Languages come only from
// normalized ISO-639 codes; native source labels stay as dim evidence.

export type LanguageBadgeInput = {
  readonly language: string; // normalized ISO-639 code only
  readonly role: "audio" | "subtitle" | "hardsub";
};

export type SourceEvidenceInput = {
  readonly nativeLabel?: string; // provider/server label — NEVER a language
  readonly host?: string;
};

const ROLE_SUFFIX: Record<LanguageBadgeInput["role"], string> = {
  audio: "audio",
  subtitle: "subs",
  hardsub: "hardsub",
};

export function formatLanguageBadge(input: LanguageBadgeInput): string {
  return `${input.language.toUpperCase()} ${ROLE_SUFFIX[input.role]}`;
}

export function formatSourceEvidence(input: SourceEvidenceInput): string {
  return [input.nativeLabel, input.host]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
