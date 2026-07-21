/**
 * Canonical install commands and 0.3.0 public-truth install hierarchy.
 *
 * Native binary is the preferred end-user path. Bun/npm globals are secondary.
 * Source checkout is contributor-oriented.
 *
 * `CANONICAL_INSTALL` still points at the Bun global until the docs reconcile
 * task flips public surfaces to the native hierarchy (release-doc-contract).
 */
export const NATIVE_INSTALL_SH =
  "curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash" as const;

export const NATIVE_INSTALL_PS1 =
  "irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex" as const;

export const BUN_GLOBAL_INSTALL = "bun install -g @kitsunekode/kunai" as const;
export const NPM_GLOBAL_INSTALL = "npm install -g @kitsunekode/kunai" as const;

/** Preferred public install command for 0.3.0 (native binary bootstrap). */
export const PREFERRED_INSTALL = NATIVE_INSTALL_SH;

/** Still Bun-global until Task 2 reconciles home/docs to PREFERRED_INSTALL. */
export const CANONICAL_INSTALL = BUN_GLOBAL_INSTALL;

export const CANONICAL_SETUP = "kunai --setup" as const;
export const VERSION_CHECK = "kunai --version" as const;
export const MPV_VERSION_CHECK = "mpv --version" as const;
export const FIRST_SEARCH = 'kunai -S "Dune"' as const;
export const PRIMARY_UPGRADE = "kunai upgrade" as const;

/** Public install hierarchy: preferred → contributor. */
export const INSTALL_HIERARCHY = ["native", "bun", "npm", "source"] as const;

/** README / getting-started quick start sequence for 0.3.0. */
export const QUICK_START_COMMANDS = [
  NATIVE_INSTALL_SH,
  VERSION_CHECK,
  MPV_VERSION_CHECK,
  CANONICAL_SETUP,
  FIRST_SEARCH,
] as const;
