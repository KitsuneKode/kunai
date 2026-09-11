import type { MobileStateStore } from "../../application/contracts";
import { decodeMobileState } from "../../application/mobile-state";
import type { AShellJsc } from "./ashell-globals";

const RUNTIME_DIRECTORY = ".runtime";
const CURRENT_PATH = `${RUNTIME_DIRECTORY}/mobile-state.json`;
const TEMPORARY_PATH = `${CURRENT_PATH}.tmp`;
const PREVIOUS_PATH = `${RUNTIME_DIRECTORY}/mobile-state.previous`;

function parseStateJson(value: string): ReturnType<typeof decodeMobileState> {
  try {
    return decodeMobileState(JSON.parse(value));
  } catch {
    throw new Error("Invalid mobile state");
  }
}

function removeIfPresent(jsc: AShellJsc, path: string): void {
  if (!jsc.isFile(path)) return;
  if (jsc.delete(path) !== 0 || jsc.isFile(path)) {
    throw new Error("state cleanup failed");
  }
}

function requireFileOperation(operation: () => number, message: string): void {
  try {
    if (operation() === 0) return;
  } catch {
    // JavaScriptCore reports native filesystem failures as exceptions as well as statuses.
  }
  throw new Error(message);
}

export function createAShellStateStore(jsc: AShellJsc): MobileStateStore {
  return {
    async load() {
      if (jsc.isFile(CURRENT_PATH)) return parseStateJson(jsc.readFile(CURRENT_PATH));
      if (jsc.isFile(PREVIOUS_PATH)) {
        const recovered = parseStateJson(jsc.readFile(PREVIOUS_PATH));
        requireFileOperation(
          () => jsc.move(PREVIOUS_PATH, CURRENT_PATH),
          "state restoration failed",
        );
        removeIfPresent(jsc, TEMPORARY_PATH);
        return recovered;
      }
      if (jsc.isFile(TEMPORARY_PATH)) {
        const recovered = parseStateJson(jsc.readFile(TEMPORARY_PATH));
        requireFileOperation(
          () => jsc.move(TEMPORARY_PATH, CURRENT_PATH),
          "state restoration failed",
        );
        return recovered;
      }
      return decodeMobileState(undefined);
    },
    async commit(next) {
      if (jsc.makeFolder(RUNTIME_DIRECTORY) !== 0) {
        throw new Error("state directory failed");
      }
      // A failed restoration may leave the only committed state in the backup.
      // Recover it before a retry can discard either transaction artifact.
      if (!jsc.isFile(CURRENT_PATH) && jsc.isFile(PREVIOUS_PATH)) {
        parseStateJson(jsc.readFile(PREVIOUS_PATH));
        requireFileOperation(
          () => jsc.move(PREVIOUS_PATH, CURRENT_PATH),
          "state restoration failed",
        );
      }
      removeIfPresent(jsc, TEMPORARY_PATH);
      const serialized = JSON.stringify(next);
      try {
        requireFileOperation(() => jsc.writeFile(TEMPORARY_PATH, serialized), "state write failed");
      } catch {
        removeIfPresent(jsc, TEMPORARY_PATH);
        throw new Error("state write failed");
      }
      if (!jsc.isFile(TEMPORARY_PATH)) throw new Error("state write failed");
      parseStateJson(jsc.readFile(TEMPORARY_PATH));

      const hasCurrent = jsc.isFile(CURRENT_PATH);
      if (hasCurrent) parseStateJson(jsc.readFile(CURRENT_PATH));
      removeIfPresent(jsc, PREVIOUS_PATH);
      try {
        if (hasCurrent)
          requireFileOperation(() => jsc.move(CURRENT_PATH, PREVIOUS_PATH), "state backup failed");
      } catch {
        removeIfPresent(jsc, TEMPORARY_PATH);
        throw new Error("state backup failed");
      }

      try {
        requireFileOperation(
          () => jsc.move(TEMPORARY_PATH, CURRENT_PATH),
          "state activation failed",
        );
      } catch {
        // Restore before cleanup: failed temporary deletion must not strand the backup.
        if (hasCurrent && jsc.isFile(PREVIOUS_PATH)) {
          requireFileOperation(
            () => jsc.move(PREVIOUS_PATH, CURRENT_PATH),
            "state restoration failed",
          );
        }
        removeIfPresent(jsc, TEMPORARY_PATH);
        throw new Error("state activation failed");
      }
      removeIfPresent(jsc, PREVIOUS_PATH);
    },
  };
}
