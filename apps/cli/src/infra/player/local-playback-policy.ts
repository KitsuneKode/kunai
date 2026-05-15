export type LocalPlaybackPolicyInput = {
  readonly autoSkipEnabled?: boolean;
  readonly skipRecap?: boolean;
  readonly skipIntro?: boolean;
  readonly skipPreview?: boolean;
  readonly skipCredits?: boolean;
};

export type LocalPlaybackPolicy = Required<LocalPlaybackPolicyInput>;

export function resolveLocalPlaybackPolicy(input: LocalPlaybackPolicyInput): LocalPlaybackPolicy {
  return {
    autoSkipEnabled: input.autoSkipEnabled ?? true,
    skipRecap: input.skipRecap ?? true,
    skipIntro: input.skipIntro ?? true,
    skipPreview: input.skipPreview ?? false,
    skipCredits: input.skipCredits ?? true,
  };
}
