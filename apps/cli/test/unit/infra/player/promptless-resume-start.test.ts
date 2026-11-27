import { describe, expect, test } from "bun:test";

import { promptlessResumeStartAt } from "@/infra/player/promptless-resume-start";

describe("promptlessResumeStartAt", () => {
  test("uses the offered resume position only when the resume-choice setting is on", () => {
    expect(
      promptlessResumeStartAt({ startAt: 0, resumePromptAt: 612, resumeStartChoicePrompt: true }),
    ).toBe(612);
    expect(
      promptlessResumeStartAt({ startAt: 0, resumePromptAt: 612, resumeStartChoicePrompt: false }),
    ).toBe(0);
  });

  test("an explicit start position always wins", () => {
    expect(
      promptlessResumeStartAt({ startAt: 44, resumePromptAt: 612, resumeStartChoicePrompt: true }),
    ).toBe(44);
    expect(
      promptlessResumeStartAt({ startAt: 44, resumePromptAt: 612, resumeStartChoicePrompt: false }),
    ).toBe(44);
  });
});
