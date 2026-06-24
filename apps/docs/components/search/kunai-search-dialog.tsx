"use client";

import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useMemo } from "react";

import { KunaiSearchEmpty, SEARCH_FALLBACK_LINKS } from "./kunai-search-empty";

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
    client: fetchClient({ api }),
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
        <SearchDialogList
          items={listItems}
          // oxlint-disable-next-line react/no-unstable-nested-components -- Empty must read the live query string
          Empty={() => <KunaiSearchEmpty query={search} />}
        />
      </SearchDialogContent>
    </SearchDialog>
  );
}
