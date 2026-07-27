/**
 * A stand-in for a spawned `chafa`.
 *
 * `stdin` is not optional here on purpose. `Bun.spawn(..., { stdin: "pipe" })`
 * always returns one, and the renderer must write the image to it *and close
 * it*. Fakes that omitted `stdin` were only viable while the production code
 * silently ignored it — which is exactly the bug that left a real chafa waiting
 * on a pipe that never ended, so `proc.exited` never settled and the poster sat
 * in its loading state until the user quit.
 *
 * Both stdin shapes are supported because that bug was believing there is only
 * one: Bun hands back a `FileSink` (`write`/`end`), not a `WritableStream`
 * (`getWriter`).
 */
export type FakeChafaState = {
  readonly bytes: number;
  readonly closed: boolean;
  readonly killed: boolean;
};

export function fakeChafaProcess(
  output: string,
  stdinShape: "sink" | "stream" = "sink",
): { proc: Bun.Subprocess; state: () => FakeChafaState } {
  let bytes = 0;
  let closed = false;
  let killed = false;

  return {
    state: () => ({ bytes, closed, killed }),
    proc: {
      stdin:
        stdinShape === "sink"
          ? {
              write: (chunk: Uint8Array) => {
                bytes += chunk.byteLength;
              },
              end: () => {
                closed = true;
              },
            }
          : new WritableStream<Uint8Array>({
              write(chunk) {
                bytes += chunk.byteLength;
              },
              close() {
                closed = true;
              },
            }),
      stdout: new Response(output).body,
      stderr: new Response("").body,
      exited: Promise.resolve(0),
      kill: () => {
        killed = true;
      },
    } as unknown as Bun.Subprocess,
  };
}
