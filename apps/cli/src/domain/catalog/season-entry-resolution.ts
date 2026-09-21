import type { TitleRelationEdge } from "@kunai/types";

/**
 * Season→entry resolution over a relation graph (#266).
 *
 * The rule the whole module exists to protect: **a sequel chain is not an
 * ordinal**. Attack on Titan is the fixture that proves it — the chain
 * `base → Season 2 → Season 3 → Season 3 Part 2 → Final Season` counted
 * naively yields season 4 = "Season 3 Part 2", which is a continuation, not a
 * new season. AniList does not type PART edges, so continuation is detected
 * by the narrow title marker (`Part N`, `Cour N`, `第Nクール`) — never by a
 * fuzzy match. Anything ambiguous returns `undefined` and the caller fails
 * closed: resolving the wrong entry silently is worse than not resolving.
 */

export interface SeasonGraphNode {
  readonly title?: string;
  readonly year?: number;
  /** AniList `format` or equivalent — MOVIE/OVA/SPECIAL are never seasons. */
  readonly format?: string;
}

export interface SeasonEntryGraph {
  readonly nodes: ReadonlyMap<string, SeasonGraphNode>;
  /** Outgoing edges per entry id, as carried on `TitleIdentity.relations`. */
  readonly edges: ReadonlyMap<string, readonly TitleRelationEdge[]>;
}

const CONTINUATION_TITLE =
  /\b(?:part|cour)\s*(?:\d+|one|two|three|four|five|i{1,4}|iv|v)\b|第\s*\d+\s*クール/i;

const NON_SEASON_FORMATS = new Set(["MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"]);

function isContinuation(node: SeasonGraphNode | undefined): boolean {
  return Boolean(node?.title && CONTINUATION_TITLE.test(node.title));
}

function isSeasonNode(node: SeasonGraphNode | undefined): boolean {
  return !NON_SEASON_FORMATS.has(node?.format?.toUpperCase() ?? "");
}

/**
 * Edges the walk may traverse: every sequel/prequel — a movie or side entry can
 * sit *on* the franchise path (Mugen Train) even though it is not a season
 * itself. Whether a hop increments the count is decided by the walker.
 */
function forwardEdges(graph: SeasonEntryGraph, id: string): readonly TitleRelationEdge[] {
  return (graph.edges.get(id) ?? []).filter((e) => e.kind === "sequel");
}

function backwardEdges(graph: SeasonEntryGraph, id: string): readonly TitleRelationEdge[] {
  return (graph.edges.get(id) ?? []).filter((e) => e.kind === "prequel");
}

/**
 * Resolve "season N" to the catalog entry that *is* that season.
 *
 * Walk the prequel chain from the picked entry to the franchise root, then
 * count forward along non-continuation sequel edges — `Part 2`/`Cour 2`
 * entries extend the current season rather than starting a new one, and
 * movies/OVAs are skipped as season nodes entirely.
 *
 * Returns `undefined` whenever the walk is ambiguous (branching sequels or
 * prequels) or the chain doesn't reach N — the caller must fail closed rather
 * than fall back to a title-string guess.
 */
export function resolveSeasonEntryId(
  graph: SeasonEntryGraph,
  pickedEntryId: string,
  season: number,
): string | undefined {
  if (!Number.isInteger(season) || season < 1) return undefined;

  // Root walk: follow prequel edges to the franchise root. Multiple prequels
  // is an ambiguous franchise — fail closed rather than pick one.
  let root = pickedEntryId;
  const seen = new Set<string>([pickedEntryId]);
  for (;;) {
    const candidates = backwardEdges(graph, root);
    if (candidates.length > 1) return undefined; // two prequels — ambiguous
    const prequel = candidates[0];
    if (!prequel) break;
    if (seen.has(prequel.targetId)) return undefined; // cycle — fail closed
    seen.add(prequel.targetId);
    root = prequel.targetId;
  }

  // Forward walk: position 1 is the root; the count advances only on a sequel
  // whose target is a real season node and not a continuation ("Part 2",
  // "Cour 2"). Movies and continuations are traversed but not counted — the
  // Mugen Train movie sits on the path to Entertainment District without
  // being season 2.
  let current = root;
  let position = isSeasonNode(graph.nodes.get(root)) ? 1 : 0;
  const walked = new Set<string>([root]);
  while (position < season) {
    const sequels = forwardEdges(graph, current);
    const seasonHops = sequels.filter((e) => {
      const node = graph.nodes.get(e.targetId);
      return isSeasonNode(node) && !isContinuation(node);
    });
    if (seasonHops.length > 1) return undefined; // branching — ambiguous
    // Prefer the season-advancing hop; otherwise continue through the one
    // unvisited traversal edge (the movie/continuation leading onward).
    const hop = seasonHops[0] ?? sequels.find((e) => !walked.has(e.targetId));
    if (!hop || walked.has(hop.targetId)) return undefined;
    walked.add(hop.targetId);
    current = hop.targetId;
    if (seasonHops[0]) position += 1;
  }
  return current;
}
