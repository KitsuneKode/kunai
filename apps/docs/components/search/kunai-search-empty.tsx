import Link from "next/link";

export const SEARCH_FALLBACK_LINKS = [
  { name: "Getting started", href: "/docs/users/getting-started" },
  { name: "Troubleshooting", href: "/docs/users/troubleshooting" },
  { name: "CLI reference", href: "/docs/users/cli-reference" },
  { name: "Supported matrix", href: "/docs/users/supported-and-unsupported" },
  { name: "Documentation index", href: "/docs" },
] as const;

export function KunaiSearchEmpty({ query }: { readonly query: string }) {
  return (
    <div className="text-fd-muted-foreground space-y-4 p-4 text-sm">
      <p>
        {query.trim().length > 0
          ? `No docs matched "${query}". Try a shorter term or browse:`
          : "Start typing to search, or jump to a guide:"}
      </p>
      <ul className="grid gap-2">
        {SEARCH_FALLBACK_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-fd-primary hover:underline">
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
