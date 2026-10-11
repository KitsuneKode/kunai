import { MarkdownText } from "@/components/shared/markdown-text";
import type { ReleaseNotesSection } from "@/lib/release-notes";

function SummaryBlocks({ summary }: { readonly summary: string }) {
  if (!summary.trim()) return null;

  return (
    <div className="text-fd-muted-foreground mt-5 flex max-w-3xl flex-col gap-3 text-sm leading-6">
      <MarkdownText>{summary}</MarkdownText>
    </div>
  );
}

type ReleaseSectionListProps = {
  readonly sections: readonly ReleaseNotesSection[];
};

export function ReleaseSectionList({ sections }: ReleaseSectionListProps) {
  if (sections.length === 0) return null;

  return (
    <div className="grid gap-6">
      {sections.map((section) => {
        // `body` keeps the section's markdown verbatim — bullets and prose in
        // order — so render it whole. Rendering `items` instead dropped every
        // prose paragraph in a section that contained a single `- ` bullet.
        const markdown = section.body.trim()
          ? section.body
          : section.items.map((item) => `- ${item}`).join("\n");
        return (
          <section
            key={section.title}
            className="border-fd-border rounded-lg border p-6"
            aria-labelledby={`release-section-${section.title}`}
          >
            <h3 id={`release-section-${section.title}`} className="kunai-type-title text-xl">
              {section.title}
            </h3>
            <div className="text-fd-muted-foreground mt-4 flex flex-col gap-2 text-sm leading-6 [&>ul]:mt-0">
              <MarkdownText>{markdown}</MarkdownText>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export { SummaryBlocks };
