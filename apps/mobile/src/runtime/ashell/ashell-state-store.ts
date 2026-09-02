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
  if (jsc.deleteFile(path) !== 0 || jsc.isFile(path)) {
    throw new Error("state cleanup failed");
  }
}

export function createAShellStateStore(jsc: AShellJsc): MobileStateStore {
  return {
    async load() {
      if (jsc.isFile(CURRENT_PATH)) return parseStateJson(jsc.readFile(CURRENT_PATH));
      if (jsc.isFile(PREVIOUS_PATH)) {
        const recovered = parseStateJson(jsc.readFile(PREVIOUS_PATH));
        if (jsc.move(PREVIOUS_PATH, CURRENT_PATH) !== 0) {
          throw new Error("state restoration failed");
        }
        removeIfPresent(jsc, TEMPORARY_PATH);
        return recovered;
      }
      if (jsc.isFile(TEMPORARY_PATH)) {
        const recovered = parseStateJson(jsc.readFile(TEMPORARY_PATH));
        if (jsc.move(TEMPORARY_PATH, CURRENT_PATH) !== 0) {
          throw new Error("state restoration failed");
        }
        return recovered;
      }
      return decodeMobileState(undefined);
    },
    async commit(next) {
      if (jsc.makeFolder(RUNTIME_DIRECTORY) !== 0) {
        throw new Error("state directory failed");
      }
      removeIfPresent(jsc, TEMPORARY_PATH);
      const serialized = JSON.stringify(next);
      if (jsc.writeFile(TEMPORARY_PATH, serialized) !== 0) {
        removeIfPresent(jsc, TEMPORARY_PATH);
        throw new Error("state write failed");
      }
      if (!jsc.isFile(TEMPORARY_PATH)) throw new Error("state write failed");
      parseStateJson(jsc.readFile(TEMPORARY_PATH));

      const hasCurrent = jsc.isFile(CURRENT_PATH);
      if (hasCurrent) parseStateJson(jsc.readFile(CURRENT_PATH));
      removeIfPresent(jsc, PREVIOUS_PATH);
      if (hasCurrent && jsc.move(CURRENT_PATH, PREVIOUS_PATH) !== 0) {
        removeIfPresent(jsc, TEMPORARY_PATH);
        throw new Error("state backup failed");
      }

      if (jsc.move(TEMPORARY_PATH, CURRENT_PATH) !== 0) {
        removeIfPresent(jsc, TEMPORARY_PATH);
        if (hasCurrent && jsc.isFile(PREVIOUS_PATH)) {
          if (jsc.move(PREVIOUS_PATH, CURRENT_PATH) !== 0) {
            throw new Error("state restoration failed");
          }
        }
        throw new Error("state activation failed");
      }
      removeIfPresent(jsc, PREVIOUS_PATH);
    },
  };
}
