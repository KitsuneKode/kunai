/**
 * Pure resolution of transient, in-memory config overrides a launch flag should
 * apply for the current session only. These are applied with `config.update()`
 * (memory-only) and never `save()`d, so they do not touch the user's config file.
 *
 * Keeping this pure lets us assert that each layout flag honestly flips the
 * config field its name implies, without booting the shell.
 */
export interface SessionOverrideArgs {
  readonly zen: boolean;
  readonly minimal: boolean;
}

export interface SessionLayoutConfig {
  readonly zenMode: boolean;
  readonly minimalMode: boolean;
}

export type SessionConfigOverrides = Partial<{
  zenMode: boolean;
  minimalMode: boolean;
}>;

/**
 * Returns only the fields that need flipping. `--zen` enables zen mode; `-m`/
 * `--minimal` enables minimal mode (companion-pane collapse, minimal footer, dim
 * header). `--zen` implies minimal upstream in cli-args, so a zen launch yields
 * both. Already-enabled fields are omitted so we never issue a no-op update.
 */
export function resolveSessionConfigOverrides(
  args: SessionOverrideArgs,
  config: SessionLayoutConfig,
): SessionConfigOverrides {
  const overrides: SessionConfigOverrides = {};
  if (args.zen && !config.zenMode) overrides.zenMode = true;
  if (args.minimal && !config.minimalMode) overrides.minimalMode = true;
  return overrides;
}
