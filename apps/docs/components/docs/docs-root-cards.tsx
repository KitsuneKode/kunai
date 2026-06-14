import { docsRootCards } from "@/lib/doc-hub";
import { Card, Cards } from "fumadocs-ui/components/card";

export function DocsRootCards() {
  return (
    <Cards className="not-prose my-8 grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-2">
      {docsRootCards.map((item) => (
        <Card
          key={item.href}
          href={item.href}
          title={item.title}
          description={item.description}
          className="kunai-fd-card h-full"
        />
      ))}
    </Cards>
  );
}
