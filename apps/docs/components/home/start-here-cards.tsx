import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeLink } from "@/lib/home-content";
import {
  IconArrowRight,
  IconCompass,
  IconLifebuoy,
  IconRocket,
  IconTerminal2,
} from "@tabler/icons-react";
import Link from "next/link";
import type { ComponentType } from "react";

type StartHereCardsProps = {
  readonly items: readonly HomeLink[];
};

type CardIcon = ComponentType<{ className?: string; stroke?: number }>;

/**
 * A glyph per destination, so four cards that were four identical text boxes
 * can be told apart before a word is read. Keyed by href because the list is
 * curated copy, not data a visitor can reorder; an href with no entry falls back
 * to the arrow, which is still a valid card.
 */
const ICON_BY_HREF = new Map<string, CardIcon>([
  ["/docs/users/getting-started", IconRocket],
  ["/docs/users/what-you-can-do", IconCompass],
  ["/docs/users/troubleshooting", IconLifebuoy],
  ["/docs/users/cli-reference", IconTerminal2],
]);

export function StartHereCards({ items }: StartHereCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = ICON_BY_HREF.get(item.href) ?? IconArrowRight;
        return (
          <Link key={item.href} href={item.href} className="group block h-full">
            <Card className="border-fd-border bg-fd-card/80 h-full transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-[var(--kunai-accent)] group-active:scale-[0.98]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-3 text-base font-medium">
                  <span className="bg-fd-muted text-fd-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" stroke={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">{item.title}</span>
                  <IconArrowRight
                    className="text-fd-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5"
                    stroke={1.5}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
