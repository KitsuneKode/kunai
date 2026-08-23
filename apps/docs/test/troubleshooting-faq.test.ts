import { describe, expect, test } from "bun:test";

import { faqPageJsonLd } from "../lib/json-ld";
import { troubleshootingFaqEntries } from "../lib/troubleshooting-faq";
import { extractFaqAnswer, parseTroubleshootingSymptoms } from "../scripts/sync-repo-content";

describe("troubleshooting FAQ", () => {
  test("symptoms YAML maps to troubleshooting headings", () => {
    expect(troubleshootingFaqEntries.length).toBeGreaterThanOrEqual(5);

    for (const entry of troubleshootingFaqEntries) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.answer.length).toBeGreaterThan(20);
    }
  });

  test("parseTroubleshootingSymptoms reads id/question/anchor triples", () => {
    const symptoms = parseTroubleshootingSymptoms(`
# comment
- id: playback-never-starts
  question: Why does playback never start?
  anchor: playback-never-starts
- id: no-results
  question: Why are there no results?
  anchor: no-results
`);

    expect(symptoms).toEqual([
      {
        id: "playback-never-starts",
        question: "Why does playback never start?",
        anchor: "playback-never-starts",
      },
      { id: "no-results", question: "Why are there no results?", anchor: "no-results" },
    ]);
  });

  test("extractFaqAnswer pulls symptoms and try steps", () => {
    const section = `**Symptoms:** Search works but playback never starts.

### What to try

1. Open \`/diagnostics\` and read the provider attempt timeline.
2. Press \`f\` or \`/fallback\` to try the next provider.
`;

    const answer = extractFaqAnswer(section);
    expect(answer).toContain("Search works but playback never starts");
    expect(answer).toContain("/diagnostics");
    expect(answer).toContain("/fallback");
  });

  test("faqPageJsonLd matches symptom questions", () => {
    const schema = faqPageJsonLd(troubleshootingFaqEntries) as {
      "@type": string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };

    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity.length).toBe(troubleshootingFaqEntries.length);
    expect(schema.mainEntity[0]?.acceptedAnswer.text.length).toBeGreaterThan(0);
  });
});
