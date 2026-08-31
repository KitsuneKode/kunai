export type MobileHttpRequest = {
  readonly method: "GET";
  readonly url: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
};

export type MobileHttpResponse = {
  readonly status: number;
  readonly bytes: number;
};

export interface MobileHttpPort {
  request(request: MobileHttpRequest): Promise<MobileHttpResponse>;
}

export type MobileState = {
  readonly schemaVersion: 1;
  readonly hostProofRuns: number;
  readonly lastResult?: "cancelled" | "http-ok" | "handoff-accepted" | "failed";
};

export interface MobileStateStore {
  load(): Promise<MobileState>;
  commit(next: MobileState): Promise<void>;
}

export interface MobileTerminalPort {
  render(lines: readonly string[]): Promise<void>;
  choose(input: {
    readonly prompt: string;
    readonly choices: readonly { readonly value: string; readonly label: string }[];
  }): Promise<
    { readonly kind: "selected"; readonly value: string } | { readonly kind: "cancelled" }
  >;
}

export interface MobilePlayerPort {
  handoff(input: {
    readonly player: "vlc";
    readonly url: string;
  }): Promise<
    | { readonly kind: "accepted"; readonly launcher: string }
    | { readonly kind: "rejected"; readonly reason: string }
  >;
}

export type MobileEnvironment = {
  readonly http: MobileHttpPort;
  readonly state: MobileStateStore;
  readonly terminal: MobileTerminalPort;
  readonly player: MobilePlayerPort;
};

export type MobileExit = {
  readonly code: number;
  readonly reason: "completed" | "cancelled" | "handoff" | "invalid-input" | "failed";
};
