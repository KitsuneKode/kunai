import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeLink } from "@/lib/home-content";
import Link from "next/link";

type StartHereCardsProps = {
  readonly items: readonly HomeLink[];
};

export function StartHereCards({ items }: StartHereCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="group block h-full">
          <Card className="border-fd-border bg-fd-card/80 h-full transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-[var(--kunai-accent)] group-active:scale-[0.98]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">
                {item.description}
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
