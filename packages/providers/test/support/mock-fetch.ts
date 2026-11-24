/**
 * Wrap a stub response function as a `typeof fetch`-shaped mock that still
 * carries `preconnect`, so assigning it to `globalThis.fetch` typechecks
 * without a cast.
 */
export function asMockFetch(fn: () => Promise<Response>): typeof fetch {
  return Object.assign(fn, { preconnect: globalThis.fetch.preconnect });
}
