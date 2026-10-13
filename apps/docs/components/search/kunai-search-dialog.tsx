"use client";

import { askAi } from "@/lib/ask-ai";
import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { KunaiSearchEmpty, KunaiSearchLoading, SEARCH_FALLBACK_LINKS } from "./kunai-search-empty";

// The AI panel (and through it the whole `@oramacloud/client` bundle) is only
// fetched if a visitor actually opens it — and it can only be opened when the
// feature is configured.
const AskAiPanel = dynamic(() => import("./ask-ai-panel").then((module) => module.AskAiPanel), {
  ssr: false,
});

const FALLBACK_LINKS = SEARCH_FALLBACK_LINKS;

type KunaiSearchDialogProps = SharedProps & {
  readonly api?: string;
  readonly delayMs?: number;
};

export function KunaiSearchDialog({
  api = "/api/search",
  delayMs,
  ...props
}: KunaiSearchDialogProps) {
  const { search, setSearch, query } = useDocsSearch({
    // Pairs with `staticGET` in the route: download the exported index once,
    // then match locally. `fetchClient` would round-trip per keystroke to a
    // route that is prerendered and cannot read the query.
    client: staticClient({ from: api }),
    delayMs,
  });

  const defaultItems = useMemo(
    () =>
      FALLBACK_LINKS.map((link) => ({
        type: "page" as const,
        id: link.name,
        content: link.name,
        url: link.href,
      })),
    [],
  );

  const [asking, setAsking] = useState(false);

  const listItems =
    query.data && query.data !== "empty"
      ? query.data
      : search.trim().length === 0
        ? defaultItems
        : [];

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        {askAi && asking ? (
          <AskAiPanel initialQuery={search} onBack={() => setAsking(false)} />
        ) : (
          <SearchDialogList
            items={listItems}
            // `Empty` is the only slot that renders when the list is empty, and
            // an in-flight search is empty too — so it has to distinguish the
            // two, or every search reads as "no matches" until it resolves.
            // oxlint-disable-next-line react/no-unstable-nested-components -- Empty must read the live query string
            Empty={() =>
              query.isLoading && search.trim().length > 0 ? (
                <KunaiSearchLoading query={search} />
              ) : (
                <KunaiSearchEmpty query={search} />
              )
            }
          />
        )}
        {askAi && !asking && (
          <SearchDialogFooter className="flex items-center justify-between gap-3 text-xs">
            <span className="text-fd-muted-foreground">
              Search stays on this device. Ask AI sends your question to {askAi.providerLabel}.
            </span>
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="text-fd-primary shrink-0 font-medium underline-offset-4 hover:underline"
            >
              Ask AI ↗
            </button>
          </SearchDialogFooter>
        )}
      </SearchDialogContent>
    </SearchDialog>
  );
}
