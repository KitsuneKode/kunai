import { getDocHubGroup, type DocHubGroupId } from "@/lib/doc-hub";
import { Card, Cards } from "fumadocs-ui/components/card";

type DocSectionCardsProps = {
  readonly group: DocHubGroupId;
};

export function DocSectionCards({ group }: DocSectionCardsProps) {
  const section = getDocHubGroup(group);
  if (!section) return null;

  const columnClass = section.items.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";

  return (
    <section className="not-prose my-8">
      <header className="mb-4 max-w-3xl">
        <p className="kunai-type-caption mb-1.5">{section.eyebrow}</p>
        <h3 className="text-fd-foreground m-0 text-xl font-normal tracking-tight">
          {section.title}
        </h3>
        <p className="text-fd-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
          {section.description}
        </p>
      </header>
      <Cards className={`grid auto-rows-fr gap-3 ${columnClass}`}>
        {section.items.map((item) => (
          <Card
            key={item.href}
            href={item.href}
            title={item.title}
            description={item.description}
            className="kunai-fd-card h-full"
          />
        ))}
      </Cards>
    </section>
  );
}
