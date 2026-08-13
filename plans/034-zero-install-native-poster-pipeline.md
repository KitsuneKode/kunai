# Plan 034: Finish the zero-install native poster pipeline

> **For agentic workers:** read `.docs/poster-image-rendering.md`, use test-driven
> development, and verify in real terminals before deleting optional fallbacks.
>
> **Drift check:** `git diff --stat 36da54c4..HEAD -- apps/cli/src/image apps/cli/src/app-shell/poster-renderer.ts apps/cli/src/app-shell/image-pane.ts apps/cli/src/app-shell/poster-source-cache.ts apps/cli/src/app-shell/use-poster-preview.ts apps/cli/test/unit/image apps/cli/test/unit/app-shell/poster-renderer.test.ts apps/cli/package.json`

**Goal:** Every interactive poster path uses bounded, aspect-preserving Bun-native
decode/resize, then hands a small prepared image to Kitty, Sixel, or half-block with
no required system image tool and no full-image synchronous decode.

**Architecture:** Deepen the existing `native-image.ts` seam into one preparation
module. Callers supply pixel bounds and bytes; the module owns validation,
orientation, aspect fit, PNG encoding, the bounded PNG-to-RGBA bridge, normalized
failure reasons, and cancellation checks. Renderers own only terminal protocol work.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Planned at:** `36da54c4`, 2026-08-11
- **Runtime contract:** Bun `>=1.3.14`; JPEG/PNG/WebP portable, GIF/BMP first-frame
  decode, TIFF unsupported on Linux, HEIC/AVIF dependent on OS codecs.

## What is already done

- Bun.Image is already the normal Kitty and half-block path.
- Source and rendered-result caches are dimension/renderer aware.
- Selection settling, abort ownership, Kitty placement cleanup, Sixel overlays, and
  the dead file-based renderer deletion have landed.
- Half-block is already the zero-install universal floor.

Do not recreate `displayPoster()` or a file renderer, and do not add Sharp.

## Confirmed remaining defects

- `native-image.ts` calls `resize(width, height)` without options. Bun's default is
  `fit:"fill"`, so portrait posters can be distorted.
- Sixel still calls `renderSixelFromBytes`, which synchronously decodes the original
  image before resizing.
- `poster-source-cache.ts` uses `arrayBuffer()` for remote and local data without a
  byte limit. The entry-count cache can retain large inputs.
- The native constructor does not set `autoOrient` or `maxPixels`.
- The proposed `PreparedPoster { png, image }` cannot come directly from Bun.Image;
  Bun has no raw-pixel terminal. Kunai must decode the already-small native PNG to
  RGBA, which is acceptable only after resize.

## Interface

Keep the external seam small and pixel-based:

```ts
type PreparedPoster = {
  readonly png: Uint8Array;
  readonly image: DecodedImage;
};

async function preparePoster(
  bytes: Uint8Array,
  bounds: { readonly maxWidthPx: number; readonly maxHeightPx: number },
  signal?: AbortSignal,
): Promise<PreparedPoster | null>;
```

Terminal-cell conversion stays outside this module: half-block requests
`cols x rows*2`; Sixel uses `pixelBudgetForCells`; Kitty uses its documented pixel
budget. This avoids pretending one cell geometry is valid for every protocol.

## Tasks

### Task 1: Lock preparation behavior in tests

- [ ] Add fixtures/tests for portrait and landscape aspect fit, no enlargement,
  EXIF orientation, JPEG/PNG/WebP, GIF/BMP first frame, unsupported format, corrupt
  data, byte limit, pixel limit, and abort-before/abort-after native work.
- [ ] Assert a portrait source is not stretched to the requested box. The current
  implementation must fail this test.
- [ ] Set `Bun.Image.backend = "bun"` only inside golden tests and restore it after.

### Task 2: Implement bounded preparation

- [ ] Construct `Bun.Image` with `autoOrient:true` and `maxPixels:4096*4096`.
- [ ] Resize with `fit:"inside"` and `withoutEnlargement:true`, encode PNG off-thread,
  then decode only that small PNG to RGBA.
- [ ] Check cancellation before construction and after each awaited native terminal.
  Document that AbortSignal does not interrupt an in-flight native terminal; stale
  results are discarded after completion.
- [ ] Normalize stable Bun image error codes for debug logging without exposing URLs
  or local paths.

### Task 3: Bound source acquisition and caches

- [ ] Enforce a 16 MiB input ceiling before preparation. Reject remote
  `Content-Length` above it; otherwise read the response stream and cancel once the
  accumulated limit is exceeded.
- [ ] Check `Bun.file(path).size` before reading local sidecars.
- [ ] Add total-byte budgets to source/prepared caches, not only entry counts. Keep
  rendered-result identity keyed by source, dimensions, renderer, and placement slot.

### Task 4: Move every renderer behind preparation

- [ ] Kitty receives prepared PNG only; remove its independent decode/conversion
  chain.
- [ ] Sixel receives prepared RGBA and calls `renderSixelFromImage`; quantization may
  remain synchronous because its input is now bounded to terminal pixels.
- [ ] Half-block receives prepared RGBA; it must not invoke a decoder.
- [ ] Preserve settled-selection debounce, in-flight ownership, resize cleanup, and
  same-slot stale-paint protection.

### Task 5: Retire optional subprocess paths only after parity

- [ ] Profile arrow-key bursts and Sixel encode time after Task 4. Add a Worker only
  if bounded quantization still causes a perceptible stall.
- [ ] Once JPEG/PNG/WebP and fallback-format tests pass on Linux/macOS/Windows, remove
  ImageMagick and Chafa runtime paths, flags, setup prompts, diagnostics fields, and
  docs in one change.
- [ ] Remove `jpeg-js` only after no interactive fallback decodes original JPEG bytes.
  Keep the small PNG decoder needed for RGBA unless Bun adds raw output.

## Verification

```sh
bun run --cwd apps/cli test:file test/unit/image test/unit/app-shell/poster-renderer.test.ts test/unit/app-shell/image-pane.test.ts test/unit/app-shell/use-poster-preview.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Manual gates: Kitty/Ghostty, Windows Terminal 1.22+ Sixel, generic half-block,
tmux/screen/SSH text fallback, rapid navigation, resize, exit cleanup, remote TMDB,
and offline sidecar artwork. Posters remain decorative: any failure must leave a
correct text UI.

## STOP conditions

- Bun.Image is absent from a supported packaged binary.
- A renderer needs incompatible pixel geometry that cannot be represented by its own
  preparation call/cache entry.
- Removing Chafa/ImageMagick causes a supported JPEG/PNG/WebP path to lose artwork.
