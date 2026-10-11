/**
 * `Bun.which` resolves against the PATH captured at process start — a later
 * `process.env.PATH` mutation is invisible to it. Anything that models an
 * environment in-process (the agent harness applies a session env, embedders
 * may adjust PATH before handing control back) needs lookups against the
 * *current* PATH, so every availability gate goes through this.
 */
export function whichLive(command: string): string | null {
  return Bun.which(command, { PATH: process.env.PATH });
}
