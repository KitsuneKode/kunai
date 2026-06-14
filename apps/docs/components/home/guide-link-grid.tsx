import type { HomeSection } from "@/lib/home-content";
import { Card, Cards } from "fumadocs-ui/components/card";

type GuideLinkGridProps = {
  readonly section: HomeSection;
};

export function GuideLinkGrid({ section }: GuideLinkGridProps) {
  return (
    <section className="kunai-doc-row grid gap-6 rounded-2xl p-6 lg:grid-cols-[0.38fr_1fr]">
      <div className="flex flex-col justify-center py-1">
        <p className="kunai-eyebrow text-[10px]">{section.eyebrow}</p>
        <h3 className="text-fd-foreground mt-2 font-serif text-xl leading-snug font-light text-balance">
          {section.title}
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-xs leading-relaxed text-pretty">
          {section.description}
        </p>
      </div>
      <Cards className="grid gap-3 sm:grid-cols-2">
        {section.items.map((item) => (
          <Card
            key={item.href}
            href={item.href}
            title={item.title}
            description={item.description}
            className="kunai-fd-card transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98]"
          />
        ))}
      </Cards>
    </section>
  );
}
