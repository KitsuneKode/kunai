#!/usr/bin/env bash
# Regenerate kanna-bust.svg from the raster master.
#
# Two steps matter and both are non-obvious:
#
#   1. Flood-fill the plate to a sentinel colour BEFORE anything else. Her eyes
#      are the same #1c1620 as the background, so `-transparent` or a global
#      colour replace punches straight through them and the fox comes out blind.
#      A flood fill from the corner only clears the connected region.
#
#   2. Remap to the three brand colours BEFORE tracing. The master carries
#      ~6,100 colours of antialiasing despite the brief specifying flat art;
#      traced raw that becomes hundreds of paths. After the remap it is 9.
#
# Requires: ImageMagick 7, vtracer (cargo install vtracer).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER="${1:-$HERE/ip-as-logo-batch/kanna-sheet-6-bust.png}"
OUT="${2:-$HERE/kanna-bust.svg}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v vtracer >/dev/null || { echo "vtracer not found — cargo install vtracer" >&2; exit 1; }

magick -size 1x1 xc:'#00FF00' xc:'#1c1620' xc:'#ff8fb0' xc:'#ffc6d8' +append "$WORK/palette.png"
magick "$MASTER" -resize 928x \
  -fuzz 18% -fill '#00FF00' -floodfill +0+0 '#1C1620' \
  +dither -remap "$WORK/palette.png" "$WORK/flat.png"

vtracer --input "$WORK/flat.png" --output "$WORK/traced.svg" \
  --colormode color --hierarchical cutout --mode spline \
  --filter_speckle 8 --color_precision 8 --gradient_step 0 \
  --corner_threshold 60 --segment_length 4 --path_precision 2

echo "Traced $(grep -c '<path' "$WORK/traced.svg") paths → $WORK/traced.svg"
echo
echo "The sentinel-green path is the cut-away background: drop it, then group the"
echo "rest as #fur / #ears-inner / #muzzle / #bib / #eyes / #nose and re-attach the"
echo "#shade layer. $OUT documents the expected structure."
