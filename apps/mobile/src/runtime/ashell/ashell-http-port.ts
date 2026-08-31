import type { MobileHttpPort } from "../../application/contracts";
import type { AShellCommandBridge } from "./ashell-command-bridge";
import type { AShellJsc } from "./ashell-globals";
import { encodeCurlConfig } from "./curl-config";

const RUNTIME_DIRECTORY = ".runtime";
const CURL_CONFIG_PATH = `${RUNTIME_DIRECTORY}/curl.conf`;
const HTTP_BODY_PATH = `${RUNTIME_DIRECTORY}/http-body`;
const HTTP_META_PATH = `${RUNTIME_DIRECTORY}/http-meta`;
const HTTP_ARTIFACTS = [CURL_CONFIG_PATH, HTTP_BODY_PATH, HTTP_META_PATH] as const;

function removeArtifacts(jsc: AShellJsc): void {
  for (const path of HTTP_ARTIFACTS) {
    if (jsc.isFile(path) && (jsc.deleteFile(path) !== 0 || jsc.isFile(path))) {
      throw new Error("HTTP cleanup failed");
    }
  }
}

function parseMetadata(value: string, maxBytes: number): { status: number; bytes: number } {
  const match = /^(\d{3})\r?\n(\d+)\r?\n?$/u.exec(value);
  if (!match) throw new Error("invalid metadata");
  const status = Number(match[1]);
  const bytes = Number(match[2]);
  if (
    !Number.isSafeInteger(status) ||
    status < 100 ||
    status > 599 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maxBytes
  ) {
    throw new Error("invalid metadata");
  }
  return { status, bytes };
}

export function createAShellHttpPort(input: {
  readonly jsc: AShellJsc;
  readonly bridge: AShellCommandBridge;
}): MobileHttpPort {
  return {
    async request(request) {
      try {
        if (input.jsc.makeFolder(RUNTIME_DIRECTORY) !== 0) throw new Error("directory");
        removeArtifacts(input.jsc);
        if (input.jsc.writeFile(CURL_CONFIG_PATH, encodeCurlConfig(request)) !== 0) {
          throw new Error("config");
        }
        if (input.bridge.runFixedHelper("http") !== 0) throw new Error("helper");
        if (!input.jsc.isFile(HTTP_BODY_PATH) || !input.jsc.isFile(HTTP_META_PATH)) {
          throw new Error("missing output");
        }
        return parseMetadata(input.jsc.readFile(HTTP_META_PATH), request.maxBytes);
      } catch {
        throw new Error("HTTP probe failed");
      } finally {
        removeArtifacts(input.jsc);
      }
    },
  };
}
