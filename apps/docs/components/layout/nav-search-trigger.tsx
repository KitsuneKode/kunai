"use client";

import { IconSearch } from "@tabler/icons-react";
import { useSearchContext } from "fumadocs-ui/contexts/search";

/**
 * The search button in the floating nav.
 *
 * Fumadocs' own button prints its label as a bare text node, which CSS cannot hide
 * on its own. The compact nav needs to keep the magnifier and drop the word and
 * the key hint, so the label and the keys are separate elements here
 * (`.kunai-nav-search__label` and `__keys`) that the compact rules collapse.
 *
 * The visible text stays in the accessibility tree when collapsed, so the button
 * is still named "Search" for assistive tech and the `title` names it for a mouse.
 */
export function NavSearchTrigger() {
  const { enabled, hotKey, setOpenSearch } = useSearchContext();
  if (!enabled) return null;

  return (
    <button
      type="button"
      data-search-full=""
      title="Search"
      onClick={() => setOpenSearch(true)}
      className="kunai-nav-search border-fd-border bg-fd-secondary/50 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center rounded-full border p-1.5 ps-2.5 text-sm transition-colors"
    >
      <IconSearch className="size-4 shrink-0" stroke={1.5} aria-hidden="true" />
      <span className="kunai-nav-search__label">Search</span>
      <span className="kunai-nav-search__keys">
        {hotKey.map((key, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- the hotkey list is fixed-order and never reordered, and its `key` field may be a function, so there is no stable value to use
          <kbd key={index} className="border-fd-border bg-fd-background rounded-md border px-1.5">
            {key.display}
          </kbd>
        ))}
      </span>
    </button>
  );
}
