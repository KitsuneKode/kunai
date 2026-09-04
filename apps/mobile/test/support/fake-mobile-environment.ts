import type {
  MobileChoiceRequest,
  MobileEnvironment,
  MobileHttpRequest,
  MobileHttpResponse,
  MobileState,
} from "../../src/application/contracts";

type ChoiceResult =
  | { readonly kind: "selected"; readonly value: string }
  | { readonly kind: "cancelled" };

export class FakeMobileEnvironment {
  readonly rendered: string[] = [];
  readonly httpRequests: MobileHttpRequest[] = [];
  readonly playerRequests: { readonly player: "vlc"; readonly url: string }[] = [];
  readonly committedStates: MobileState[] = [];
  readonly choices: ChoiceResult[] = [];
  readonly chooseRequests: MobileChoiceRequest[] = [];
  closeCount = 0;

  initialState: MobileState = { schemaVersion: 1, hostProofRuns: 0 };
  httpResponse: MobileHttpResponse = { status: 204, bytes: 0 };
  handoffResult:
    | { readonly kind: "accepted"; readonly launcher: string }
    | { readonly kind: "rejected"; readonly reason: string } = {
    kind: "accepted",
    launcher: "fixture",
  };
  loadError?: Error;
  httpError?: Error;
  handoffError?: Error;

  readonly environment: MobileEnvironment = {
    http: {
      request: async (request) => {
        this.httpRequests.push(request);
        if (this.httpError) throw this.httpError;
        return this.httpResponse;
      },
    },
    state: {
      load: async () => {
        if (this.loadError) throw this.loadError;
        return this.initialState;
      },
      commit: async (next) => {
        this.committedStates.push(next);
      },
    },
    terminal: {
      render: async (lines) => {
        this.rendered.push(...lines);
      },
      choose: async (request) => {
        this.chooseRequests.push(request);
        return this.choices.shift() ?? { kind: "cancelled" };
      },
      close: async () => {
        this.closeCount += 1;
      },
    },
    player: {
      handoff: async (request) => {
        this.playerRequests.push(request);
        if (this.handoffError) throw this.handoffError;
        return this.handoffResult;
      },
    },
  };
}
