import { __testing as convertTesting } from "@/image/convert";

/**
 * Pin whether the host "has" ImageMagick, independent of whether it really does.
 *
 * `ensurePngBytes` resolves `magick` through its own module-level seam in
 * `@/image/convert`, not through the seam a renderer exposes. A test that stubs
 * only the renderer's `which` therefore still reaches the *host's* ImageMagick
 * on any path that falls through to conversion: hermetic on a machine without
 * it, a real subprocess on a machine with it.
 *
 * That split is exactly how the Windows CI leg broke while Linux and macOS
 * stayed green -- the `windows-latest` runner image ships ImageMagick 7, the
 * Ubuntu and macOS images do not. The poster renderer's Kitty-fallback test
 * spawned a real `magick`, blew Bun's 5s per-test budget, and then failed a
 * second time as an "unhandled error between tests" when the late promise
 * settled against stubs `afterEach` had already restored.
 *
 * Pass `null` to assert a conversion path *without* an external converter, or a
 * path string to make the binary appear present (pair that with a stubbed
 * `convertTesting.runtime.spawn`, or the test will spawn the real thing).
 *
 * Returns the restore function; every caller must run it.
 */
export function stubMagickResolution(resolvedPath: string | null): () => void {
  const original = convertTesting.runtime.which;
  convertTesting.runtime.which = (command: string) =>
    command === "magick" ? resolvedPath : original(command);
  return () => {
    convertTesting.runtime.which = original;
  };
}
