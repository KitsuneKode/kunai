"use client";

import { IconSearch } from "@tabler/icons-react";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import type { FullSearchTriggerProps } from "fumadocs-ui/layouts/shared/slots/search-trigger";

import { NavLabel } from "./nav-compact";

/** Reuses Fumadocs' lazy search dialog and its platform-specific shortcut. */
export function NavSearchTrigger({ hideIfDisabled, className, ...props }: FullSearchTriggerProps) {
  const { enabled, hotKey, setOpenSearch } = useSearchContext();
  if (hideIfDisabled && !enabled) return null;
  return (
    <button
      {...props}
      type="button"
      data-search-full=""
      aria-label="Open Search"
      className={`kunai-nav-search ${className ?? ""}`}
      onClick={() => setOpenSearch(true)}
    >
      <NavLabel>
        <IconSearch size={16} aria-hidden="true" />
      </NavLabel>
      <span className="kunai-nav-search__label">
        <NavLabel>Search</NavLabel>
      </span>
      <span className="kunai-nav-search__keys" aria-hidden="true">
        <NavLabel>
          {hotKey.map((key) => (
            <kbd key={String(key.key)}>{key.display}</kbd>
          ))}
        </NavLabel>
      </span>
    </button>
  );
}
