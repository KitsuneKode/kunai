import { describe, expect, test } from "bun:test";

import {
  formatBootstrapPlan,
  resolveAutoPickIndex,
  resolveBootstrapIntent,
  resolveLaunchSurfaceName,
} from "@/app/bootstrap/bootstrap-intent";
import { parseCliArgs } from "@/cli-args";

function parse(argv: string[]) {
  return parseCliArgs(argv);
}

/**
 * `--zen` is documented as a layout ("Zen mode (bare, ani-cli-style)") and
 * `docs/users/cli-reference.mdx` enumerates the flags that auto-play —
 * `--jump` and `--quick` — without listing `--zen`. It nonetheless set
 * `quick`, which `resolveBootstrapIntent` reads as "auto-pick result #1", so
 * `-S "Dune" --zen` skipped the result list and played the top hit.
 */
describe("--zen is a layout flag, not a selection flag", () => {
  test("sets minimal chrome without implying quick", () => {
    const args = parse(["--zen"]);
    expect(args.zen).toBe(true);
    expect(args.minimal).toBe(true);
    expect(args.quick).toBe(false);
  });

  test("does not auto-pick a search result", () => {
    const args = parse(["-S", "Dune", "--zen"]);
    expect(resolveBootstrapIntent(args).autoPickSearchResultIndex).toBeUndefined();
  });

  test("still composes explicitly with --quick", () => {
    const args = parse(["-S", "Dune", "--zen", "--quick"]);
    expect(args.minimal).toBe(true);
    expect(resolveBootstrapIntent(args).autoPickSearchResultIndex).toBe(1);
  });

  test("--quick alone still auto-picks — that behaviour is documented", () => {
    const args = parse(["-S", "Dune", "--quick"]);
    expect(resolveBootstrapIntent(args).autoPickSearchResultIndex).toBe(1);
  });

  test("--jump still wins over quick", () => {
    const args = parse(["-S", "Dune", "--quick", "--jump", "3"]);
    expect(resolveBootstrapIntent(args).autoPickSearchResultIndex).toBe(3);
  });
});

/** One rule, one place — `main.ts`'s download path restated this verbatim. */
describe("resolveAutoPickIndex", () => {
  test("jump wins, then quick+query, otherwise nothing", () => {
    expect(resolveAutoPickIndex({ jump: 4, quick: false })).toBe(4);
    expect(resolveAutoPickIndex({ quick: true, search: "Dune" })).toBe(1);
    expect(resolveAutoPickIndex({ quick: true })).toBeUndefined();
    expect(resolveAutoPickIndex({ quick: false, search: "Dune" })).toBeUndefined();
  });

  test("a whitespace-only query is not a query", () => {
    expect(resolveAutoPickIndex({ quick: true, search: "   " })).toBeUndefined();
  });
});

/**
 * `--dry-run` is documented as "prints the planned bootstrap without changing
 * state" and was read only inside `--install-protocol-handler` and `rollback`.
 * On the launch path it parsed and did nothing.
 */
describe("--dry-run plan", () => {
  test("reports the query, surface and that nothing auto-plays", () => {
    const args = parse(["-S", "Dune", "--dry-run"]);
    const lines = formatBootstrapPlan({
      intent: resolveBootstrapIntent(args),
      mode: "movie/series",
      route: resolveLaunchSurfaceName(args),
      download: args.download,
      setup: args.setup,
    });
    const text = lines.join("\n");

    expect(text).toContain("nothing was changed");
    expect(text).toContain("Dune");
    expect(text).toContain("search");
    expect(text).toContain("no (results are shown)");
    expect(text).toContain("play");
  });

  test("names the direct title and the download action", () => {
    const args = parse(["-i", "438631", "-t", "movie", "--download", "--dry-run"]);
    const text = formatBootstrapPlan({
      intent: resolveBootstrapIntent(args),
      mode: "movie/series",
      route: resolveLaunchSurfaceName(args),
      download: args.download,
      setup: args.setup,
    }).join("\n");

    expect(text).toContain("438631 (movie)");
    expect(text).toContain("download only (no playback)");
  });

  test("surfaces the flags the launch path would silently drop", () => {
    const args = parse(["-i", "438631", "-a", "--dry-run"]);
    const text = formatBootstrapPlan({
      intent: resolveBootstrapIntent(args),
      mode: "anime",
      route: resolveLaunchSurfaceName(args),
      download: args.download,
      setup: args.setup,
    }).join("\n");

    expect(text).toContain("ignored in anime mode");
    expect(text).toContain("438631");
  });

  test("reports the named surface a route flag selects", () => {
    const args = parse(["--history", "--dry-run"]);
    expect(resolveLaunchSurfaceName(args)).toBe("watch history");
  });
});
