import { directIdTitleName } from "@/domain/types";
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

/**
 * The single auto-pick rule: `--jump N` wins, otherwise quick-mode with a query
 * takes the top hit.
 *
 * Exported because the download path in `main.ts` restated this expression
 * verbatim. Two copies of a selection policy is how they drift — and the
 * behaviour they encode (silently playing result #1) is exactly the kind that
 * must not diverge between surfaces.
 */
export function resolveAutoPickIndex(args: {
  readonly jump?: number;
  readonly quick: boolean;
  readonly search?: string;
}): number | undefined {
  if (args.jump !== undefined) return args.jump;
  return args.quick && args.search?.trim() ? 1 : undefined;
}

/** Named launch surfaces, in the precedence the launch path applies them. */
export function resolveLaunchSurfaceName(args: {
  readonly offline: boolean;
  readonly history: boolean;
  readonly continuePlayback: boolean;
  readonly download: boolean;
  readonly setup: boolean;
  readonly initialRoute?: string;
}): string | undefined {
  if (args.setup) return "setup";
  if (args.offline) return "offline library";
  if (args.history) return "watch history";
  if (args.continuePlayback) return "continue watching";
  if (args.initialRoute) return args.initialRoute;
  if (args.download) return "download";
  return undefined;
}

/** What `--dry-run` reports about a launch, before anything is created. */
export interface BootstrapPlanInput {
  readonly intent: BootstrapIntent;
  readonly mode: string;
  readonly route?: string;
  readonly shareAction?: string;
  readonly download: boolean;
  readonly setup: boolean;
}

/**
 * Render the planned bootstrap as human-readable lines.
 *
 * `docs/users/cli-reference.mdx` promises `--dry-run` "prints the planned
 * bootstrap without changing state", and `--help` lists it as a general flag.
 * It was read in exactly two places -- `--install-protocol-handler` and
 * `rollback` -- so on the launch path it parsed and did nothing, and
 * `kunai -S "Dune" --dry-run` started the very session it promised not to.
 *
 * Pure so the plan can be asserted without booting the shell, and so the caller
 * can print it before any container, database, or probe exists.
 */
export function formatBootstrapPlan(input: BootstrapPlanInput): readonly string[] {
  const { intent } = input;
  const lines = ["kunai --dry-run: planned bootstrap (nothing was changed)"];

  lines.push(`  mode:        ${input.mode}`);
  lines.push(`  surface:     ${input.route ?? (input.setup ? "setup" : "search")}`);

  if (intent.directTitle) {
    lines.push(`  title:       ${intent.directTitle.id} (${intent.directTitle.type})`);
  } else if (intent.query) {
    lines.push(`  query:       ${intent.query}`);
  } else {
    lines.push("  query:       (none — opens the shell)");
  }

  lines.push(
    `  auto-pick:   ${
      intent.autoPickSearchResultIndex === undefined
        ? "no (results are shown)"
        : `result #${intent.autoPickSearchResultIndex}`
    }`,
  );
  lines.push(`  action:      ${input.download ? "download only (no playback)" : "play"}`);

  if (input.shareAction) {
    lines.push(`  share link:  ${input.shareAction}`);
  }

  // Surface the same drops the launch path reports, so a dry run explains why a
  // flag will be ignored instead of leaving the user to discover it at runtime.
  for (const entry of intent.logs) {
    if (entry.kind === "anime-id-unsupported") {
      lines.push(`  warning:     -i/--id is ignored in anime mode (${entry.id})`);
    }
    if (entry.kind === "id-without-type") {
      lines.push(`  warning:     -i/--id needs -t movie|series, so ${entry.id} is ignored`);
    }
  }

  return lines;
}

export function resolveBootstrapIntent(args: BootstrapArgs): BootstrapIntent {
  const logs: BootstrapLog[] = [];

  const trimmedQuery = args.search?.trim();
  const query = trimmedQuery ? trimmedQuery : undefined;
  if (query) {
    logs.push({ kind: "search", query });
  }

  const directTitle = resolveDirectTitle(args, logs);

  // A direct title never needs a search auto-pick (there is no result list).
  const autoPickSearchResultIndex = resolveAutoPickIndex({
    jump: args.jump,
    quick: args.quick,
    search: query,
  });

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
      name: directIdTitleName(args.id),
    };
  }
  logs.push({ kind: "id-without-type", id: args.id, type: args.type });
  return null;
}
