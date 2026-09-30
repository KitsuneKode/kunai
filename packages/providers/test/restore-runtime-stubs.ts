import { afterEach } from "bun:test";

const originalFetch = globalThis.fetch;
const originalWhich = Bun.which;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Bun.which = originalWhich;
});
