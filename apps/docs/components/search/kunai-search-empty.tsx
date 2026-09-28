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
    <div className="text-fd-muted-foreground flex flex-col gap-4 p-4 text-sm">
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

/**
 * Shown while a search is in flight, in place of the "no matches" copy.
 *
 * The static index is one file the browser downloads on the first keystroke,
 * so there is a real window — longer on a cold cache than any per-query
 * round-trip would be — where the list is legitimately empty. Rendering "no
 * docs matched" during it tells the reader their search failed when it has not
 * even run, which is worse than saying nothing.
 */
export function KunaiSearchLoading({ query }: { readonly query: string }) {
  return (
    <div className="text-fd-muted-foreground flex items-center gap-3 p-4 text-sm">
      <span
        aria-hidden
        className="border-fd-muted-foreground/30 border-t-fd-primary size-4 animate-spin rounded-full border-2"
      />
      <p aria-live="polite">Searching for &ldquo;{query.trim()}&rdquo;&hellip;</p>
    </div>
  );
}
