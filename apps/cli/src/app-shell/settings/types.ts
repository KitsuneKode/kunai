import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import type { SyncAuthAvailability } from "@/services/sync/auth-contract";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import type { SyncStatus } from "@/services/sync/SyncService";

import type { ShellPickerOption } from "../types";
import type { SectionLayout } from "./layouts";

export type SettingGate = {
  readonly env?: string;
  readonly tuningKey?: string;
  readonly predicate?: (config: KitsuneConfig) => boolean;
};

export type SettingsRegistryContext = {
  readonly config: KitsuneConfig;
  readonly presenceSnapshot: PresenceSnapshot | null;
  readonly seriesProviderOptions: readonly ShellPickerOption<string>[];
  readonly animeProviderOptions: readonly ShellPickerOption<string>[];
  readonly youtubeProviderOptions: readonly ShellPickerOption<string>[];
  /**
   * A typed projection, not a door into the service. Settings decides what to
   * offer from declared capabilities and resolved auth availability only — never
   * from `process.env`, a credential literal, or adapter internals.
   */
  readonly sync: {
    readonly adapters: readonly SyncAdapter[];
    readonly authAvailability: SyncAuthAvailability;
    readonly status: SyncStatus;
  };
  readonly container: Container;
};

export type EnumOption = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

export type SettingActionOptions = {
  readonly signal: AbortSignal;
  readonly onStatus: (message: string | null) => void;
};

type SettingRowMetadata = {
  readonly configKeys?: readonly (keyof KitsuneConfig)[];
};

export type SettingRowDef = SettingRowMetadata &
  (
    | {
        readonly kind: "section";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly layout?: SectionLayout;
      }
    | {
        readonly kind: "boolean";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly read: (config: KitsuneConfig) => boolean;
        readonly write: (config: KitsuneConfig, value: boolean) => KitsuneConfig;
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "enum";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly options: readonly EnumOption[];
        readonly read: (config: KitsuneConfig) => string;
        readonly write: (config: KitsuneConfig, value: string) => KitsuneConfig;
        readonly presentation?: "segment" | "submenu";
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "text";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly sensitive?: boolean;
        readonly placeholder: string;
        readonly read: (config: KitsuneConfig) => string;
        readonly apply: (config: KitsuneConfig, value: string) => KitsuneConfig;
        readonly validate: (value: string) => string | null;
        readonly envOverride?: string;
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "submenu";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly summarize: (config: KitsuneConfig) => string;
        readonly buildChoices: (
          ctx: SettingsRegistryContext,
        ) => readonly ShellPickerOption<string>[];
        readonly onPick: (
          config: KitsuneConfig,
          value: string,
          ctx: SettingsRegistryContext,
        ) => KitsuneConfig | { readonly next: KitsuneConfig; readonly stay: true };
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "reorder";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly resolveOrder: (config: KitsuneConfig) => readonly string[];
        readonly applyOrder: (config: KitsuneConfig, order: readonly string[]) => KitsuneConfig;
        readonly providerOptions: (
          ctx: SettingsRegistryContext,
        ) => readonly ShellPickerOption<string>[];
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "action";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly tone?: "danger";
        readonly cancellable?: boolean;
        readonly run: (
          ctx: SettingsRegistryContext,
          options?: SettingActionOptions,
        ) => Promise<string | void>;
        readonly gate?: SettingGate;
      }
    | {
        readonly kind: "status";
        readonly id: string;
        readonly label: string;
        readonly detail?: string;
        readonly tone?: "success" | "warning" | "info" | "error";
        readonly gate?: SettingGate;
      }
  );

export type SettingsInputMode =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly settingId: string;
      readonly buffer: string;
      readonly seed: string;
    };

export type SettingsUiState = {
  readonly draft: KitsuneConfig;
  readonly snapshot: KitsuneConfig;
  readonly submenuId: string | null;
  readonly parentIndex: number;
  readonly inputMode: SettingsInputMode;
  readonly searchQuery: string;
  readonly activeSectionIndex: number;
  readonly selectedIndex: number;
  readonly error: string | null;
  readonly busy: boolean;
  readonly activeActionId: string | null;
  /**
   * Bumped when an action completes. Actions can change state the draft cannot
   * see — connecting a tracker moves adapter state, not config — so this is
   * what re-derives the registry context.
   */
  readonly revision: number;
};

export type BuiltSettingsRow = {
  readonly def: SettingRowDef;
  readonly label: string;
  readonly detail?: string;
  readonly valueSummary: string;
  readonly disabledReason?: string;
  readonly envBadge?: string;
};

export type BuiltSettingsPage = {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly BuiltSettingsRow[];
  readonly rowById: ReadonlyMap<string, BuiltSettingsRow>;
  readonly defById: ReadonlyMap<string, SettingRowDef>;
};
