import type { MobileChoiceRequest, MobileChoiceResult } from "./contracts";

export const MOBILE_INVALID_SELECTION = "Invalid selection. Try again.\n";

export type MobileChoiceInterpretation = MobileChoiceResult | { readonly kind: "invalid" };

export function formatMobileChoiceOptions(request: MobileChoiceRequest): string {
  return `${request.choices
    .map((choice, index) => `${index + 1}. ${choice.label}`)
    .join("\n")}\n0. Cancel\n`;
}

export function interpretMobileChoiceAnswer(
  request: MobileChoiceRequest,
  answer: string | undefined,
): MobileChoiceInterpretation {
  // Soft keyboards on both hosts add stray spaces, and a-Shell's `read -r`
  // preserves them verbatim, so an untrimmed answer rejects "1 " and leaves the
  // tester in the retry loop with no way to tell what the host disliked.
  const trimmed = answer?.trim();
  if (trimmed === undefined || trimmed === "" || trimmed === "0") return { kind: "cancelled" };

  const numeric = /^[1-9]\d*$/u.test(trimmed) ? Number(trimmed) : Number.NaN;
  const numericChoice = Number.isSafeInteger(numeric) ? request.choices[numeric - 1] : undefined;
  const choice = numericChoice ?? request.choices.find((candidate) => candidate.value === trimmed);
  return choice ? { kind: "selected", value: choice.value } : { kind: "invalid" };
}
