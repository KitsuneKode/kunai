import { docNavEntries, type DocNavGroup } from "./doc-navigation";

export function navGroupForHref(href: string): DocNavGroup | null {
  const entry = docNavEntries.find((item) => item.href === href);
  return entry?.group ?? null;
}
