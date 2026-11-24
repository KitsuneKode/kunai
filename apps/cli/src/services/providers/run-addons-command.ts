import { ADDONS_SUBCOMMANDS } from "@/cli-args";
import {
  addStremioAddon,
  cleanStremioAddonName,
  findInstalledStremioAddon,
  readInstalledStremioAddons,
  removeStremioAddonFromConfig,
  stremioAddonReferenceSlice,
  type InstalledStremioAddon,
  type StremioAddonReferenceSlice,
} from "@/domain/provider/stremio-addons";
import {
  describeManifestResources,
  fetchStremioManifest,
  manifestServesStream,
  parseStremioAddonUrl,
  scrubStremioAddonText,
  toDisplayText,
  type StremioManifest,
} from "@kunai/providers/stremio-addon";
import type { ProviderRuntimeContext } from "@kunai/types";
import { ProviderHttpError } from "@kunai/types";

/** The part of the config service this command reads and writes. */
export interface AddonsConfigPort extends StremioAddonReferenceSlice {
  update(partial: Partial<StremioAddonReferenceSlice>): Promise<void>;
  save(): Promise<void>;
  flushPending(): Promise<void>;
}

export interface RunAddonsCommandOptions {
  /** Absent or `undefined` means `list`. */
  readonly subcommand?: string | undefined;
  /** `add`: the manifest URL. `remove`/`check`: a number from `list`, an id, a host or a name. */
  readonly target?: string | undefined;
  /** `add` only: read the manifest URL from standard input instead of the positional. */
  readonly stdin?: boolean;
  /** Overrides the stdin read. Defaults to one bounded line of process stdin. */
  readonly readInput?: () => Promise<string>;
  readonly json?: boolean;
  readonly write?: (text: string) => void;
  /** Defaults to the user's real config, opened the way startup opens it. */
  readonly openConfig?: () => Promise<AddonsConfigPort>;
  /** How addons are reached. Defaults to the guarded platform fetch. */
  readonly context?: ProviderRuntimeContext;
}

interface AddonSummary {
  readonly number: number;
  readonly id: string;
  readonly name: string;
  readonly host: string;
}

/** What may be printed about an addon. The URL is not part of it: its path can hold a token. */
function summarize(addon: InstalledStremioAddon, index: number): AddonSummary {
  return { number: index + 1, id: addon.providerId, name: addon.displayName, host: addon.host };
}

/** Which of the two things Kunai plays an addon can be asked for. */
interface AddonUsability {
  readonly movie: boolean;
  readonly series: boolean;
  /** Why the addon cannot be used at all; `null` when it can. */
  readonly reason: string | null;
}

/** One addon's line in `kunai addons check`. */
interface AddonCheckReport extends AddonSummary {
  readonly reachable: boolean;
  readonly usable: boolean;
  readonly manifestName: string | null;
  readonly version: string | null;
  readonly movie: boolean;
  readonly series: boolean;
  readonly streamTypes: readonly string[];
  readonly problem: string | null;
}

/**
 * Everything `--json` may print, before `schemaVersion` is added. Every form
 * carries `ok` and `error`; the rest depends on the action.
 */
type AddonsCommandOutput =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly error: null; readonly addons: readonly AddonSummary[] }
  | {
      readonly ok: true;
      readonly error: null;
      readonly added: boolean;
      readonly addon: AddonSummary;
      readonly movie: boolean;
      readonly series: boolean;
    }
  | {
      readonly ok: true;
      readonly error: null;
      readonly removed: AddonSummary;
      readonly appliesAfterRestart: true;
    }
  | {
      readonly ok: boolean;
      readonly error: string | null;
      readonly addons: readonly AddonCheckReport[];
    };

/**
 * Whether Kunai can ask this addon for the two things it plays. An addon that
 * only lists catalogs, or only answers ids Kunai cannot map to, would sit in
 * the provider order and never return a stream.
 */
function describeUsability(manifest: StremioManifest): AddonUsability {
  if (manifest.behaviorHints?.configurationRequired === true) {
    return {
      movie: false,
      series: false,
      reason:
        "the addon must be configured on its own page first; add the manifest URL it gives you after that",
    };
  }
  const movie = manifestServesStream(manifest, "movie");
  const series = manifestServesStream(manifest, "series");
  if (movie.served || series.served) {
    return { movie: movie.served, series: series.served, reason: null };
  }
  return {
    movie: false,
    series: false,
    reason: movie.reason === "the addon has no movie streams" ? series.reason : movie.reason,
  };
}

/** Bounded stdin read for `add --stdin`: the first line only, capped. */
const STDIN_URL_MAX_BYTES = 4096;

/**
 * One line of standard input. Byte-bounded before decoding so a stream with no
 * newline cannot grow the buffer without limit, the line ends at the first
 * LF byte, and an overlong line is refused rather than truncated into a
 * different URL; the input is never written to output — it can hold the
 * addon's token.
 */
export async function readAddonInputLine(
  input: AsyncIterable<Uint8Array> = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const end = bytes.indexOf(10);
    const prefix = end >= 0 ? bytes.subarray(0, end) : bytes;
    total += prefix.length;
    if (total > STDIN_URL_MAX_BYTES) {
      throw new Error("addon stdin line exceeded byte limit");
    }
    chunks.push(prefix);
    if (end >= 0) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

const readAddonInput = () => readAddonInputLine();

/** Errors the addon client builds are already URL-free; anything else is not trusted to be. */
function errorMessage(cause: unknown): string {
  return cause instanceof ProviderHttpError ? cause.message : "the addon could not be reached";
}

export async function runAddonsCommand(options: RunAddonsCommandOptions): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const action = options.subcommand ?? "list";
  const json = Boolean(options.json);
  const context: ProviderRuntimeContext = options.context ?? {
    now: () => new Date().toISOString(),
  };
  const emit = (payload: AddonsCommandOutput, text: string): void => {
    write(json ? `${JSON.stringify({ schemaVersion: 1, ...payload }, null, 2)}\n` : `${text}\n`);
  };
  const fail = (code: 1 | 2, reason: string): number => {
    // The action is caller input and can be a pasted URL holding a token —
    // the reason is fixed text, the subcommand is never echoed back.
    emit({ ok: false, error: reason }, `kunai addons: ${reason}`);
    return code;
  };

  if (!ADDONS_SUBCOMMANDS.some((known) => known === action)) {
    return fail(2, `unknown action. Use one of: ${ADDONS_SUBCOMMANDS.join(", ")}.`);
  }
  if (options.stdin && action !== "add") {
    return fail(2, "--stdin is only for `kunai addons add`.");
  }

  const openConfig =
    options.openConfig ??
    (async () => {
      const { openStandaloneConfig } = await import("@/services/persistence/standalone-config");
      return openStandaloneConfig();
    });
  const config = await openConfig();
  const installed = readInstalledStremioAddons(config.stremioAddons);

  if (action === "list") {
    const addons = installed.map(summarize);
    emit(
      { ok: true, error: null, addons },
      addons.length === 0
        ? "No Stremio addons installed. Add one with: kunai addons add <manifest-url>"
        : [
            "Stremio addons (movies and series):",
            ...addons.map(
              (addon) => `  ${addon.number}. ${addon.name}  ${addon.host}  ${addon.id}`,
            ),
            "",
            "Order and switches: Settings → Sources. Remove with: kunai addons remove <number>",
          ].join("\n"),
    );
    return 0;
  }

  if (action === "add") {
    if (options.stdin && options.target) {
      return fail(2, "use either --stdin or a manifest URL, not both.");
    }
    let target = options.target;
    if (options.stdin) {
      try {
        target = await (options.readInput ?? readAddonInput)();
      } catch {
        return fail(1, "the manifest URL could not be read from standard input.");
      }
    }
    if (!target) return fail(2, "missing the addon's manifest URL.");
    const parsed = parseStremioAddonUrl(target);
    if (!parsed.ok) return fail(2, parsed.reason);

    // The manifest is read before anything is stored: an address that is not
    // a Stremio addon, or one Kunai could never get a stream from, is refused
    // here instead of sitting in the provider order doing nothing.
    let manifest: StremioManifest;
    try {
      manifest = await fetchStremioManifest(parsed.addon, { context });
    } catch (error) {
      return fail(1, `${errorMessage(error)}. Nothing was added.`);
    }
    const usability = describeUsability(manifest);
    if (usability.reason) {
      // The name is the addon's own text; it is printed only after cleaning.
      const shown =
        cleanStremioAddonName(manifest.name, parsed.addon.manifestUrl) ?? parsed.addon.host;
      return fail(1, `"${shown}" cannot be used: ${usability.reason}. Nothing was added.`);
    }

    const result = addStremioAddon(config.stremioAddons, parsed.addon.manifestUrl, manifest.name);
    if (!result.ok) return fail(1, result.reason);
    await config.update({ stremioAddons: result.entries });
    await config.save();
    await config.flushPending();

    const kinds = [usability.movie ? "movies" : null, usability.series ? "series" : null]
      .filter(Boolean)
      .join(" and ");
    emit(
      {
        ok: true,
        error: null,
        added: result.added,
        addon: summarize(
          result.addon,
          readInstalledStremioAddons(result.entries).findIndex(
            (entry) => entry.providerId === result.addon.providerId,
          ),
        ),
        movie: usability.movie,
        series: usability.series,
      },
      result.added
        ? [
            `Added "${result.addon.displayName}" (${result.addon.host}) for ${kinds}.`,
            "Kunai asks it after your other providers, starting the next time Kunai opens.",
            "Change its place in the order, or switch it off, in Settings → Sources.",
          ].join("\n")
        : `"${result.addon.displayName}" (${result.addon.host}) is already installed.`,
    );
    return 0;
  }

  const targeted = options.target
    ? findInstalledStremioAddon(installed, options.target)
    : undefined;
  if (targeted === "ambiguous") {
    return fail(2, "more than one addon matches; use its number from `kunai addons list`.");
  }
  if (options.target && !targeted) {
    return fail(1, "no installed addon matches; see `kunai addons list`.");
  }

  if (action === "remove") {
    if (!targeted) return fail(2, "say which addon: a number from `kunai addons list`.");
    await config.update(
      stremioAddonReferenceSlice(removeStremioAddonFromConfig(config, targeted.providerId)),
    );
    await config.save();
    await config.flushPending();
    emit(
      {
        ok: true,
        error: null,
        removed: summarize(targeted, installed.indexOf(targeted)),
        appliesAfterRestart: true,
      },
      `Removed "${targeted.displayName}" (${targeted.host}). Already-running Kunai sessions stop using it after restart.`,
    );
    return 0;
  }

  // check
  const subjects = targeted ? [targeted] : installed;
  if (subjects.length === 0) {
    emit({ ok: true, error: null, addons: [] }, "No Stremio addons installed.");
    return 0;
  }
  const reports = await Promise.all(
    subjects.map(async (addon): Promise<AddonCheckReport> => {
      const summary = summarize(addon, installed.indexOf(addon));
      try {
        const manifest = await fetchStremioManifest(addon, { context });
        const usability = describeUsability(manifest);
        const resources = describeManifestResources(manifest);
        return {
          ...summary,
          reachable: true,
          usable: usability.reason === null,
          manifestName: cleanStremioAddonName(manifest.name, addon.manifestUrl) ?? null,
          version:
            toDisplayText(scrubStremioAddonText(manifest.version, addon.manifestUrl), 32) ?? null,
          movie: usability.movie,
          series: usability.series,
          streamTypes: resources.streamTypes,
          problem: usability.reason,
        };
      } catch (error) {
        return {
          ...summary,
          reachable: false,
          usable: false,
          manifestName: null,
          version: null,
          movie: false,
          series: false,
          streamTypes: [],
          problem: errorMessage(error),
        };
      }
    }),
  );
  const ok = reports.every((report) => report.usable);
  emit(
    { ok, error: ok ? null : "one or more addons cannot be used", addons: reports },
    reports
      .map((report) =>
        report.usable
          ? `  ${report.number}. ${report.name}  ${report.host}  ok — ${[
              report.movie ? "movies" : null,
              report.series ? "series" : null,
            ]
              .filter(Boolean)
              .join(" and ")}${report.version ? `, v${report.version}` : ""}`
          : `  ${report.number}. ${report.name}  ${report.host}  problem — ${report.problem}`,
      )
      .join("\n"),
  );
  return ok ? 0 : 1;
}
