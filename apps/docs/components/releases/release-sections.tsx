import type { ReleaseNotesSection } from "@/lib/release-notes";

function SummaryBlocks({ summary }: { readonly summary: string }) {
  const blocks = summary
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return null;

  return (
    <div className="text-fd-muted-foreground mt-5 flex max-w-3xl flex-col gap-3 text-sm leading-6">
      {blocks.map((block) => (
        <p key={block.slice(0, 64)} className="m-0">
          {block}
        </p>
      ))}
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
      {sections.map((section) => (
        <section
          key={section.title}
          className="border-fd-border rounded-lg border p-6"
          aria-labelledby={`release-section-${section.title}`}
        >
          <h3 id={`release-section-${section.title}`} className="kunai-type-title text-xl">
            {section.title}
          </h3>
          {section.items.length > 0 ? (
            <ul className="text-fd-muted-foreground mt-4 grid gap-3 text-sm leading-6">
              {section.items.map((item) => (
                <li key={item.slice(0, 80)}>{item}</li>
              ))}
            </ul>
          ) : (
            <div className="text-fd-muted-foreground mt-4 text-sm leading-6 whitespace-pre-wrap">
              {section.body}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export { SummaryBlocks };
