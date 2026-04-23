#!/usr/bin/env bash
# Build a Chrome Web Store-ready ZIP of the extension.
# Output: dist/auto_unmute-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./manifest.json').version)" 2>/dev/null || \
          python3 -c "import json; print(json.load(open('manifest.json'))['version'])")

OUT_DIR="dist"
ZIP_NAME="auto_unmute-${VERSION}.zip"
mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/${ZIP_NAME}"

# Files / dirs that ship in the extension. Anything not listed here is excluded.
INCLUDE=(
  manifest.json
  background.js
  content_script.js
  change_popup.js
  auto_unmute.html
  auto_unmute.js
  audio_level_worklet.js
  popup.html
  popup.js
  LICENSE
  css
  js
  images
  models
)

zip -r -q "${OUT_DIR}/${ZIP_NAME}" "${INCLUDE[@]}" \
  -x "*.DS_Store" "*/.DS_Store" "images/_src_*" "readme_images/*"

echo "Built ${OUT_DIR}/${ZIP_NAME}"
ls -lh "${OUT_DIR}/${ZIP_NAME}"
unzip -l "${OUT_DIR}/${ZIP_NAME}" | tail -3
