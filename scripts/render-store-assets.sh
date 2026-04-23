#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/store_assets/src"
OUT_DIR="$ROOT_DIR/store_assets/out"
DOCS_DIR="$ROOT_DIR/docs/screenshots"

if ! command -v sips >/dev/null 2>&1; then
  echo "Error: 'sips' command not found." >&2
  echo "This script currently relies on macOS sips for SVG->PNG rendering." >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$DOCS_DIR"

assets=()
if [ "$#" -eq 0 ]; then
  for svg in "$SRC_DIR"/*.svg; do
    assets+=("$(basename "$svg" .svg)")
  done
else
  assets=("$@")
fi

rendered=0
for name in "${assets[@]}"; do
  svg="$SRC_DIR/$name.svg"
  if [ ! -f "$svg" ]; then
    echo "Error: unknown store asset '$name' (expected $svg)." >&2
    exit 1
  fi
  out_png="$OUT_DIR/$name.png"
  docs_png="$DOCS_DIR/$name.png"

  sips -s format png "$svg" --out "$out_png" >/dev/null
  cp "$out_png" "$docs_png"
  rendered=$((rendered + 1))
done

echo "Rendered $rendered store assets to:"
echo "  - $OUT_DIR"
echo "  - $DOCS_DIR"
