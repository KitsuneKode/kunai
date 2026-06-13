export type HomeCliOption = {
  readonly short: string;
  readonly long: string;
  readonly description: string;
};

export type HomeProviderMetadata = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly string[];
  readonly capabilities: readonly string[];
  readonly status: string;
  readonly notes: readonly string[];
};

export type HomeCommandMetadata = {
  readonly id: string;
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly description: string;
};

export type HomeLogEntry = {
  readonly id: string;
  readonly text: string;
};
