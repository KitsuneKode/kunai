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

const ICON_BY_HREF = new Map<string, CardIcon>([
  ["/docs/users/getting-started", IconRocket],
  ["/docs/users/what-you-can-do", IconCompass],
  ["/docs/users/troubleshooting", IconLifebuoy],
  ["/docs/users/cli-reference", IconTerminal2],
]);

/** Unified hairline-ruled row list matching the provider directory language. */
export function StartHereCards({ items }: StartHereCardsProps) {
  return (
    <ul className="kunai-row-list">
      {items.map((item) => {
        const Icon = ICON_BY_HREF.get(item.href) ?? IconArrowRight;
        return (
          <li key={item.href} className="kunai-row-item">
            <Link href={item.href} className="kunai-editorial-row">
              <span className="kunai-editorial-row__icon" aria-hidden="true">
                <Icon className="size-4" stroke={1.5} />
              </span>
              <span className="kunai-editorial-row__title">{item.title}</span>
              <span className="kunai-editorial-row__desc">{item.description}</span>
              <IconArrowRight className="kunai-row-arrow size-4 shrink-0" stroke={1.5} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
