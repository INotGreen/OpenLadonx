#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
PLIST_PATH="$HOME/Library/LaunchAgents/com.codexmonitor.morning-briefing.plist"
TIME_HOUR="${1:-8}"
TIME_MINUTE="${2:-0}"

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.codexmonitor.morning-briefing</string>
    <key>ProgramArguments</key>
    <array>
      <string>$SCRIPT_DIR/morning-briefing.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
      <dict>
        <key>Weekday</key>
        <integer>2</integer>
        <key>Hour</key>
        <integer>$TIME_HOUR</integer>
        <key>Minute</key>
        <integer>$TIME_MINUTE</integer>
      </dict>
      <dict>
        <key>Weekday</key>
        <integer>3</integer>
        <key>Hour</key>
        <integer>$TIME_HOUR</integer>
        <key>Minute</key>
        <integer>$TIME_MINUTE</integer>
      </dict>
      <dict>
        <key>Weekday</key>
        <integer>4</integer>
        <key>Hour</key>
        <integer>$TIME_HOUR</integer>
        <key>Minute</key>
        <integer>$TIME_MINUTE</integer>
      </dict>
      <dict>
        <key>Weekday</key>
        <integer>5</integer>
        <key>Hour</key>
        <integer>$TIME_HOUR</integer>
        <key>Minute</key>
        <integer>$TIME_MINUTE</integer>
      </dict>
      <dict>
        <key>Weekday</key>
        <integer>6</integer>
        <key>Hour</key>
        <integer>$TIME_HOUR</integer>
        <key>Minute</key>
        <integer>$TIME_MINUTE</integer>
      </dict>
    </array>
    <key>StandardOutPath</key>
    <string>/tmp/com.codexmonitor.morning-briefing.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/com.codexmonitor.morning-briefing.err</string>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
EOF

/bin/chmod +x "$SCRIPT_DIR/morning-briefing.sh" "$SCRIPT_DIR/install-morning-briefing.sh"
/bin/launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
/bin/launchctl load "$PLIST_PATH"

printf 'Installed %s at %s:%s\n' "$PLIST_PATH" "$TIME_HOUR" "$TIME_MINUTE"
