import type { SearchStartupRoute } from "@/app/search/search-startup-policy";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

/**
 * The launch intent the session loop is still holding.
 *
 * Deliberately one mutable object rather than a handful of locals. It was six
 * independent `let`s cleared per branch, and the direct-title branch cleared
 * only two of them: `initialQuery`, `initialRoute`, `autoPickSearchResultIndex`
 * and `preserveExistingSearch` were reset exclusively inside the *search*
 * branch, which that path skips.
 *
 * The result was a launch carrying both a query and a direct target
 * (`-S "Dune" --history`, a share link, `-i` with `-t`) leaving the query armed:
 * when the chosen title finished, the loop came back round and ran a search
 * nobody asked for. The auto-pick index survived with it, so under
 * `--quick`/`--zen` that stale search immediately played its first hit — a
 * history row and a tracker sync for a title the user never selected.
 */
export interface PendingSessionBootstrap {
  initialTitle: TitleInfo | null;
  initialEpisode: EpisodeInfo | null;
  initialQuery?: string;
  initialRoute?: SearchStartupRoute;
  preserveExistingSearch: boolean;
  autoPickSearchResultIndex?: number;
}

export interface SessionBootstrapInput {
  readonly initialTitle?: TitleInfo | null;
  readonly initialEpisode?: EpisodeInfo | null;
  readonly initialQuery?: string;
  readonly initialRoute?: SearchStartupRoute;
  readonly preserveExistingSearch?: boolean;
  readonly autoPickSearchResultIndex?: number;
}

export function createPendingBootstrap(bootstrap: SessionBootstrapInput): PendingSessionBootstrap {
  return {
    initialTitle: bootstrap.initialTitle ?? null,
    initialEpisode: bootstrap.initialEpisode ?? null,
    initialQuery: bootstrap.initialQuery,
    initialRoute: bootstrap.initialRoute,
    preserveExistingSearch: bootstrap.preserveExistingSearch ?? false,
    autoPickSearchResultIndex: bootstrap.autoPickSearchResultIndex,
  };
}

/**
 * Spend the launch intent — every field, in one call.
 *
 * A bootstrap intent is one-shot: it describes how the *first* surface opens,
 * so once it has produced a title or run its search, nothing it carries applies
 * to the next iteration. Clearing all of it together is what makes that true;
 * clearing fields individually per branch is what let four of six survive.
 */
export function spendBootstrapIntent(pending: PendingSessionBootstrap): void {
  pending.initialTitle = null;
  pending.initialEpisode = null;
  pending.initialQuery = undefined;
  pending.initialRoute = undefined;
  pending.preserveExistingSearch = false;
  pending.autoPickSearchResultIndex = undefined;
}
