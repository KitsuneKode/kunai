/**
 * Provider-payload helpers layered on the shared boundary types. `AstroValue`
 * covers Astro's tagged-tuple serialization: tags this package does not read
 * decode to `undefined`, so decoded props are "JSON with holes".
 */
import type { LooseJsonValue } from "@kunai/types";

export {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
  type LooseJsonValue,
} from "@kunai/types";

export type AstroValue = LooseJsonValue;
