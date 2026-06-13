import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { CliFlagsTable } from "./components/reference/cli-flags-table";
import { CommandReference } from "./components/reference/command-reference";
import { ProviderTable } from "./components/reference/provider-table";
import { SyncedAt } from "./components/reference/synced-at";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ProviderTable,
    CommandReference,
    CliFlagsTable,
    SyncedAt,
    ...components,
  };
}
