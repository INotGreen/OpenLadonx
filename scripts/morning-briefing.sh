#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPORT_DIR="${MORNING_BRIEFING_DIR:-$HOME/Documents/MorningBriefings}"
STAMP=$(date '+%Y-%m-%d')
REPORT_PATH="$REPORT_DIR/$STAMP.md"

mkdir -p "$REPORT_DIR"

/usr/bin/osascript -l JavaScript "$SCRIPT_DIR/morning-briefing.js" >"$REPORT_PATH"

/usr/bin/osascript <<EOF
display notification "晨间简报已生成" with title "Morning Briefing" subtitle "$STAMP"
EOF

printf '%s\n' "$REPORT_PATH"
