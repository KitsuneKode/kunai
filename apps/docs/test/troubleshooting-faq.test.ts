import { describe, expect, test } from "bun:test";

import { faqPageJsonLd } from "../lib/json-ld";
import {
  buildTroubleshootingFaqEntries,
  extractFaqAnswer,
  readTroubleshootingSymptoms,
} from "../lib/troubleshooting-faq";

describe("troubleshooting FAQ", () => {
  test("symptoms YAML maps to troubleshooting headings", () => {
    const symptoms = readTroubleshootingSymptoms();
    expect(symptoms.length).toBeGreaterThanOrEqual(5);

    const entries = buildTroubleshootingFaqEntries();
    expect(entries.length).toBe(symptoms.length);

    for (const entry of entries) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.answer.length).toBeGreaterThan(20);
    }
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
    const entries = buildTroubleshootingFaqEntries();
    const schema = faqPageJsonLd(entries) as {
      "@type": string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };

    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity.length).toBe(entries.length);
    expect(schema.mainEntity[0]?.acceptedAnswer.text.length).toBeGreaterThan(0);
  });
});
