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

export type MobileChoiceRequest = {
  readonly prompt: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
};

export type MobileChoiceResult =
  | { readonly kind: "selected"; readonly value: string }
  | { readonly kind: "cancelled" };

export interface MobileTerminalPort {
  render(lines: readonly string[]): Promise<void>;
  choose(input: MobileChoiceRequest): Promise<MobileChoiceResult>;
  /**
   * Releases whatever host input handle the port holds. A terminal port that
   * keeps a live handle keeps the host alive with it, so every exit path has to
   * come back through here — not only the interrupted one.
   */
  close(): Promise<void>;
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
