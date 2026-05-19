import type {
  ProviderId,
  ProviderSourceStatus,
  ResolveErrorCode,
  StreamPresentation,
  SubtitleDelivery,
} from "@kunai/types";

export type PlaybackInventoryOptionState =
  | "selected"
  | "available"
  | "failed"
  | "skipped"
  | "disabled";

export type PlaybackInventoryWarningTone = "info" | "warning" | "danger";

export type PlaybackRecoveryActionId =
  | "retry-current"
  | "next-server"
  | "next-source"
  | "fallback-provider"
  | "refresh-stream"
  | "cancel";

export type PlaybackSourceSelectionView = {
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly variantId?: string;
  readonly qualityLabel?: string;
  readonly presentation?: StreamPresentation;
  readonly audioLanguages: readonly string[];
  readonly subtitleLanguages: readonly string[];
  readonly subtitleDelivery?: SubtitleDelivery;
};

export type PlaybackSourceGroupView = {
  readonly id: string;
  readonly label: string;
  readonly state: PlaybackInventoryOptionState;
  readonly providerId: ProviderId;
  readonly sourceIds: readonly string[];
  readonly streamIds: readonly string[];
  readonly nativeLabels: readonly string[];
  readonly presentation?: StreamPresentation;
  readonly audioLanguages: readonly string[];
  readonly subtitleLanguages: readonly string[];
  readonly subtitleDelivery?: SubtitleDelivery;
  readonly candidateCount: number;
  readonly providerStatus?: ProviderSourceStatus;
  readonly disabledReason?: string;
};

export type PlaybackLanguageOptionView = {
  readonly id: string;
  readonly label: string;
  readonly state: PlaybackInventoryOptionState;
  readonly role: "audio" | "subtitle" | "hardsub";
  readonly language?: string;
  readonly presentation?: StreamPresentation;
  readonly nativeLabels: readonly string[];
  readonly sourceIds: readonly string[];
  readonly streamIds: readonly string[];
  readonly candidateCount: number;
  readonly restartRequired: boolean;
  readonly disabledReason?: string;
};

export type PlaybackQualityOptionView = {
  readonly id: string;
  readonly label: string;
  readonly state: PlaybackInventoryOptionState;
  readonly qualityRank?: number;
  readonly sourceIds: readonly string[];
  readonly streamIds: readonly string[];
  readonly candidateCount: number;
  readonly restartRequired: boolean;
  readonly disabledReason?: string;
};

export type PlaybackSubtitleOptionView = {
  readonly id: string;
  readonly label: string;
  readonly state: PlaybackInventoryOptionState;
  readonly delivery: SubtitleDelivery | "off" | "unknown";
  readonly language?: string;
  readonly nativeLabels: readonly string[];
  readonly sourceIds: readonly string[];
  readonly streamIds: readonly string[];
  readonly subtitleIds: readonly string[];
  readonly candidateCount: number;
  readonly restartRequired: boolean;
  readonly disabledReason?: string;
};

export type PlaybackRecoveryActionView = {
  readonly id: PlaybackRecoveryActionId;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly preservesTimestamp: boolean;
  readonly changesCacheIdentity: boolean;
};

export type PlaybackInventoryWarningView = {
  readonly id: string;
  readonly tone: PlaybackInventoryWarningTone;
  readonly message: string;
  readonly code?: ResolveErrorCode;
  readonly developerDetail?: string;
};

export type PlaybackTraceSummaryView = {
  readonly providerId: ProviderId;
  readonly selectedStreamId?: string;
  readonly sourceCount: number;
  readonly streamCount: number;
  readonly subtitleCount: number;
  readonly failureCount: number;
  readonly eventCount: number;
  readonly cacheHit: boolean;
};

export type PlaybackSourceInventoryView = {
  readonly providerId: ProviderId;
  readonly status: "resolved" | "exhausted";
  readonly selected?: PlaybackSourceSelectionView;
  readonly sourceGroups: readonly PlaybackSourceGroupView[];
  readonly languageOptions: readonly PlaybackLanguageOptionView[];
  readonly qualityOptions: readonly PlaybackQualityOptionView[];
  readonly subtitleOptions: readonly PlaybackSubtitleOptionView[];
  readonly recoveryActions: readonly PlaybackRecoveryActionView[];
  readonly warnings: readonly PlaybackInventoryWarningView[];
  readonly traceSummary?: PlaybackTraceSummaryView;
};
