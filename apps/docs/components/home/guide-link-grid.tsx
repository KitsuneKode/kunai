import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeSection } from "@/lib/home-content";
import Link from "next/link";

type GuideLinkGridProps = {
  readonly section: HomeSection;
};

export function GuideLinkGrid({ section }: GuideLinkGridProps) {
  return (
    <section className="kunai-doc-row grid gap-6 rounded-2xl p-6 lg:grid-cols-[0.38fr_1fr]">
      <div className="flex flex-col justify-center py-1">
        <Badge variant="muted" className="kunai-type-caption w-fit">
          {section.eyebrow}
        </Badge>
        <h3 className="text-fd-foreground mt-2 font-serif text-xl leading-snug font-light text-balance">
          {section.title}
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-xs leading-relaxed text-pretty">
          {section.description}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {section.items.map((item) => (
          <Link key={item.href} href={item.href} className="group block h-full">
            <Card className="border-fd-border bg-fd-card/80 h-full transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-[var(--kunai-accent)] group-active:scale-[0.98]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs leading-relaxed">
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
