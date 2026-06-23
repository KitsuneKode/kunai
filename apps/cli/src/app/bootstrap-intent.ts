import type { TitleInfo } from "@/domain/types";

/**
 * Pure resolution of how a CLI invocation should bootstrap the first session
 * surface, derived only from parsed args (after any protocol-handoff merge).
 *
 * The I/O-bound bootstrap branches (`--history`, `--continue`, `--offline`,
 * `--download`) stay in {@link file://./main.ts} because they read the container
 * (history store, pickers, download phase). This module owns the deterministic
 * decisions — search query, direct TMDB title, and the auto-pick index — so they
 * can be unit-tested without booting the shell.
 */
export interface BootstrapIntent {
  /** Trimmed search query to seed the search surface, when provided. */
  readonly query?: string;
  /** Direct TMDB title to resolve immediately, when `-i/--id` is usable. */
  readonly directTitle: TitleInfo | null;
  /** Index (1-based) to auto-pick from search results, when known up front. */
  readonly autoPickSearchResultIndex?: number;
  /** Structured launch log directives for the caller to forward to its logger. */
  readonly logs: readonly BootstrapLog[];
}

export type BootstrapLog =
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "direct-title"; readonly id: string; readonly type: "movie" | "series" }
  | { readonly kind: "anime-id-unsupported"; readonly id: string }
  | { readonly kind: "id-without-type"; readonly id: string; readonly type?: string };

export interface BootstrapArgs {
  readonly search?: string;
  readonly id?: string;
  readonly type?: string;
  readonly anime: boolean;
  readonly quick: boolean;
  readonly jump?: number;
}

export function resolveBootstrapIntent(args: BootstrapArgs): BootstrapIntent {
  const logs: BootstrapLog[] = [];

  const trimmedQuery = args.search?.trim();
  const query = trimmedQuery ? trimmedQuery : undefined;
  if (query) {
    logs.push({ kind: "search", query });
  }

  const directTitle = resolveDirectTitle(args, logs);

  // `--jump N` wins; otherwise quick-mode with a query auto-picks the top hit.
  // A direct title never needs a search auto-pick (there is no result list).
  let autoPickSearchResultIndex = args.jump;
  if (autoPickSearchResultIndex === undefined && args.quick && query) {
    autoPickSearchResultIndex = 1;
  }

  return { query, directTitle, autoPickSearchResultIndex, logs };
}

function resolveDirectTitle(args: BootstrapArgs, logs: BootstrapLog[]): TitleInfo | null {
  if (!args.id) return null;
  if (args.anime) {
    logs.push({ kind: "anime-id-unsupported", id: args.id });
    return null;
  }
  if (args.type === "movie" || args.type === "series") {
    logs.push({ kind: "direct-title", id: args.id, type: args.type });
    return {
      id: args.id,
      type: args.type,
      name: `TMDB ${args.id}`,
    };
  }
  logs.push({ kind: "id-without-type", id: args.id, type: args.type });
  return null;
}
