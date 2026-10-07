import { isJsonObject, isJsonString } from "@kunai/types";

/** Decode a caught filesystem cause's errno code (`ENOENT`, `EEXIST`, …) before treating it as evidence. */
export function errorCode(cause: unknown): string | undefined {
  return isJsonObject(cause) && isJsonString(cause.code) ? cause.code : undefined;
}
