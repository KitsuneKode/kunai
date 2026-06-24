import fs from "node:fs";
import path from "node:path";

export type TroubleshootingSymptom = {
  readonly id: string;
  readonly question: string;
  readonly anchor: string;
};

const DOCS_ROOT = path.join(path.resolve(process.cwd(), "../.."), "docs");

export function readTroubleshootingSymptoms(
  yamlPath = path.join(DOCS_ROOT, "troubleshooting-symptoms.yaml"),
): TroubleshootingSymptom[] {
  const content = fs.readFileSync(yamlPath, "utf-8");
  const symptoms: TroubleshootingSymptom[] = [];
  let current: { id?: string; question?: string; anchor?: string } | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const listMatch = line.match(/^- id:\s*(.+)$/);
    if (listMatch?.[1]) {
      if (current?.id && current.question && current.anchor) {
        symptoms.push(current as TroubleshootingSymptom);
      }
      current = { id: listMatch[1] };
      continue;
    }

    if (!current) continue;
    const questionMatch = line.match(/^question:\s*(.+)$/);
    if (questionMatch?.[1]) {
      current.question = questionMatch[1];
      continue;
    }
    const anchorMatch = line.match(/^anchor:\s*(.+)$/);
    if (anchorMatch?.[1]) {
      current.anchor = anchorMatch[1];
    }
  }

  if (current?.id && current.question && current.anchor) {
    symptoms.push(current as TroubleshootingSymptom);
  }

  return symptoms;
}

function sectionForAnchor(mdx: string, anchor: string): string | null {
  const headingPattern = new RegExp(`^## ${escapeRegExp(anchor)}\\s*$`, "im");
  const match = headingPattern.exec(mdx);
  if (match === null) return null;

  const start = match.index + match[0].length;
  const rest = mdx.slice(start);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest.trim() : rest.slice(0, nextHeading).trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractFaqAnswer(section: string): string {
  const symptomsMatch = section.match(/\*\*Symptoms:\*\*\s*(.+)/);
  const tryBlockMatch = section.match(/### What to try\s+([\s\S]*?)(?=###|More:|$)/);
  const trySteps = tryBlockMatch?.[1]
    ? [...tryBlockMatch[1].matchAll(/^\d+\.\s+(.+)$/gm)]
        .map((step) => (step[1] ?? "").replace(/\[[^\]]+\]\([^)]+\)/g, "").trim())
        .filter((step) => step.length > 0)
        .slice(0, 3)
    : [];

  const parts: string[] = [];
  if (symptomsMatch?.[1]) {
    parts.push(symptomsMatch[1].trim());
  }
  if (trySteps.length > 0) {
    parts.push(trySteps.join(" "));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildTroubleshootingFaqEntries(
  mdxPath = path.join(DOCS_ROOT, "users/troubleshooting.mdx"),
): { question: string; answer: string }[] {
  const mdx = fs.readFileSync(mdxPath, "utf-8");
  const symptoms = readTroubleshootingSymptoms();

  return symptoms.map((symptom) => {
    const section = sectionForAnchor(mdx, symptom.anchor);
    const answer = section ? extractFaqAnswer(section) : "";
    return {
      question: symptom.question,
      answer:
        answer.length > 0 ? answer : `See the ${symptom.anchor} section in Kunai troubleshooting.`,
    };
  });
}
