import {
  type SessionStateManager,
  SessionStateManagerImpl,
} from "@/domain/session/SessionStateManager";
import type { Logger } from "@/infra/logger/Logger";

/** Real state/reducer for workflow tests, without log output or profile access. */
export function createTestStateManager(provider = "vidking"): SessionStateManager {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger,
  };
  const state = new SessionStateManagerImpl({ logger });
  state.initialize(provider, "allanime", {
    anime: { audio: "original", subtitle: "none" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "none" },
  });
  return state;
}
