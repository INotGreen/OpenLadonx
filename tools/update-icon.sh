#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CALLER_DIR="$(pwd)"

RUN_BUILD=0
SOURCE_ICON=""

usage() {
  echo "Usage: npm run icon:update -- <path-to-square-png> [--build]"
  echo ""
  echo "Updates:"
  echo "  - icon.png"
  echo "  - public/app-icon.png"
  echo "  - src-tauri/icons/* via tauri icon"
  echo "  - src-tauri/icons/tray-icon.png"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      RUN_BUILD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1"
      usage
      exit 1
      ;;
    *)
      if [ -n "$SOURCE_ICON" ]; then
        echo "ERROR: only one source icon path is supported."
        usage
        exit 1
      fi
      SOURCE_ICON="$1"
      ;;
  esac
  shift
done

if [ -z "$SOURCE_ICON" ]; then
  echo "ERROR: missing source icon path."
  usage
  exit 1
fi

case "$SOURCE_ICON" in
  /*)
    SOURCE_ICON_ABS="$SOURCE_ICON"
    ;;
  *)
    SOURCE_ICON_ABS="$CALLER_DIR/$SOURCE_ICON"
    ;;
esac

if [ ! -f "$SOURCE_ICON_ABS" ]; then
  echo "ERROR: source icon does not exist: $SOURCE_ICON_ABS"
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "ERROR: sips is required to inspect and resize icons."
  exit 1
fi

FORMAT="$(sips -g format "$SOURCE_ICON_ABS" 2>/dev/null | awk '/format:/ { print $2 }')"
WIDTH="$(sips -g pixelWidth "$SOURCE_ICON_ABS" 2>/dev/null | awk '/pixelWidth:/ { print $2 }')"
HEIGHT="$(sips -g pixelHeight "$SOURCE_ICON_ABS" 2>/dev/null | awk '/pixelHeight:/ { print $2 }')"

if [ "$FORMAT" != "png" ]; then
  echo "ERROR: source icon must be a PNG file. Detected: ${FORMAT:-unknown}"
  exit 1
fi

if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ] || [ "$WIDTH" != "$HEIGHT" ]; then
  echo "ERROR: source icon must be square. Detected: ${WIDTH:-?}x${HEIGHT:-?}"
  exit 1
fi

cd "$CLIENT_DIR"

echo "Updating source icon..."
if ! cmp -s "$SOURCE_ICON_ABS" icon.png; then
  cp "$SOURCE_ICON_ABS" icon.png
fi

echo "Generating Tauri icon set..."
npm run tauri -- icon icon.png

echo "Syncing frontend icon..."
mkdir -p public
cp icon.png public/app-icon.png

echo "Generating tray icon..."
sips -z 64 64 icon.png --out src-tauri/icons/tray-icon.png >/dev/null

if [ "$RUN_BUILD" -eq 1 ]; then
  echo "Building frontend..."
  npm run build
fi

echo "Done."
echo "Source: icon.png (${WIDTH}x${HEIGHT})"
echo "Use --build when you also want dist/ refreshed."
