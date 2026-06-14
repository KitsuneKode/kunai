import { getDocHubGroup, type DocHubGroupId } from "@/lib/doc-hub";
import { Card, Cards } from "fumadocs-ui/components/card";

type DocSectionCardsProps = {
  readonly group: DocHubGroupId;
};

export function DocSectionCards({ group }: DocSectionCardsProps) {
  const section = getDocHubGroup(group);
  if (!section) return null;

  return (
    <section className="not-prose my-10">
      <header className="mb-5 max-w-3xl">
        <p className="kunai-type-caption mb-2">{section.eyebrow}</p>
        <h3 className="kunai-type-title m-0">{section.title}</h3>
        <p className="kunai-type-body mt-2 mb-0">{section.description}</p>
      </header>
      <Cards className="grid auto-rows-fr gap-3 sm:grid-cols-2">
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
