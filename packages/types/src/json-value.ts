/**
 * Boundary JSON shapes and decoders. `Response.json()` and parsed cache/storage
 * payloads hand back `any`; these types and guards are where that `any`
 * becomes a contract.
 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * JSON after transforms that can introduce `undefined` (tagged decoders,
 * redaction passes): values may be absent where strict JSON could not be.
 */
export type LooseJsonValue =
  | JsonValue
  | undefined
  | readonly LooseJsonValue[]
  | { readonly [key: string]: LooseJsonValue };

export function isJsonObject<T>(value: T): value is T & JsonObject {
  return value instanceof Object && !Array.isArray(value);
}

export function isJsonString<T>(value: T): value is T & string {
  // This primitive boundary check must never invoke untrusted conversion hooks.
  // eslint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "string";
}

export function isJsonNumber<T>(value: T): value is T & number {
  return Object.prototype.toString.call(value) === "[object Number]" && !(value instanceof Object);
}
