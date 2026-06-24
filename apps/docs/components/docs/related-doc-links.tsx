import { docNavEntries, type DocNavGroup } from "@/lib/doc-navigation";
import Link from "next/link";

type RelatedDocLinksProps = {
  readonly group: DocNavGroup;
  readonly currentHref: string;
  readonly limit?: number;
};

export function RelatedDocLinks({ group, currentHref, limit = 5 }: RelatedDocLinksProps) {
  const related = docNavEntries
    .filter((entry) => entry.group === group && entry.href !== currentHref)
    .slice(0, limit);

  if (related.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Related guides" className="not-prose border-fd-border mt-10 border-t pt-6">
      <p className="text-fd-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
        Related guides
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {related.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="text-fd-primary hover:text-fd-foreground text-sm font-medium transition-colors"
            >
              {entry.title}
            </Link>
            <p className="text-fd-muted-foreground mt-0.5 text-xs leading-relaxed">
              {entry.description}
            </p>
          </li>
        ))}
      </ul>
    </nav>
  );
}
