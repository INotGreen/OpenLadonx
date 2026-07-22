#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENV_FILE="${R2_ENV_FILE:-$ROOT/.r2-upload.local}"

[ -f "$ENV_FILE" ] && . "$ENV_FILE"

command -v curl >/dev/null 2>&1 || { echo "Missing curl" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Missing node" >&2; exit 1; }

R2_ENDPOINT="${R2_ENDPOINT:-https://6574805ffed382ca64a880212f02a7d3.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-www}"
R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-952e633bd7a347ab4e6c2e25109da804}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-7ca842fdb02d44e34d5a8a29f02818724f5bea7733cce7b34a00eca971bc16b4}"
R2_PREFIX="${R2_PREFIX:-ladonxbin}"
R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://pub-cee1ec26d75f4f07bbd449bed039a36b.r2.dev/ladonxbin}"
CURL_RETRY_ARGS=(--retry 5 --retry-delay 2 --retry-all-errors)

latest_release_dir() {
  find "$ROOT/desktop-release" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null \
    | sort \
    | tail -n 1
}

resolve_release_dir() {
  local input="$1"

  if [ -z "$input" ]; then
    return 1
  fi

  if [ -d "$input" ]; then
    cd "$input" && pwd
    return 0
  fi

  if [ -d "$ROOT/$input" ]; then
    cd "$ROOT/$input" && pwd
    return 0
  fi

  if [ -d "$ROOT/desktop-release/$input" ]; then
    cd "$ROOT/desktop-release/$input" && pwd
    return 0
  fi

  return 1
}

build_desktop_release() {
  local before_latest after_latest

  before_latest="$(latest_release_dir || true)"
  echo "No release directory provided. Building desktop release first..."
  npm run build:desktop
  after_latest="$(latest_release_dir || true)"

  [ -n "$after_latest" ] || {
    echo "Build finished but no release directory was found under desktop-release/." >&2
    exit 1
  }

  if [ -n "$before_latest" ] && [ "$after_latest" = "$before_latest" ]; then
    echo "Using latest release directory: $after_latest"
  fi

  printf '%s\n' "$after_latest"
}

object_key() {
  local key="${1#/}"

  if [ -n "$R2_PREFIX" ]; then
    printf '%s/%s' "${R2_PREFIX%/}" "$key"
  else
    printf '%s' "$key"
  fi
}

object_url() {
  local key="$1"

  node -e '
const endpoint = process.argv[1].replace(/\/+$/, "");
const bucket = process.argv[2];
const key = process.argv[3];
const encodedKey = key
  .split("/")
  .map((part) => encodeURIComponent(part))
  .join("/");
process.stdout.write(`${endpoint}/${bucket}/${encodedKey}`);
' "$R2_ENDPOINT" "$R2_BUCKET" "$key"
}

file_md5() {
  local file="$1"

  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$file"
    return
  fi

  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$file" | awk '{print $1}'
    return
  fi

  openssl dgst -md5 -r "$file" | awk '{print $1}'
}

remote_object_headers() {
  local key="$1"

  curl --silent --show-error --ipv4 \
    "${CURL_RETRY_ARGS[@]}" \
    --aws-sigv4 "aws:amz:us-east-1:s3" \
    --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" \
    -I \
    "$(object_url "$key")"
}

remote_object_matches_file() {
  local file="$1"
  local key="$2"
  local tmp_headers
  local local_size
  local remote_size
  local local_md5
  local remote_etag

  tmp_headers="$(mktemp -t ladonx-upload-head)"
  if ! remote_object_headers "$key" >"$tmp_headers" 2>/dev/null; then
    rm -f "$tmp_headers"
    return 1
  fi

  local_size="$(wc -c <"$file" | tr -d '[:space:]')"
  remote_size="$(
    awk 'BEGIN { IGNORECASE = 1 } /^Content-Length:/ { gsub("\r", "", $2); print $2; exit }' "$tmp_headers"
  )"
  remote_etag="$(
    awk 'BEGIN { IGNORECASE = 1 } /^ETag:/ { gsub("\r", "", $2); gsub(/"/, "", $2); print $2; exit }' "$tmp_headers"
  )"
  rm -f "$tmp_headers"

  [ -n "$remote_size" ] || return 1
  [ "$remote_size" = "$local_size" ] || return 1

  [ -n "$remote_etag" ] || return 0

  local_md5="$(file_md5 "$file")"
  [ "$remote_etag" = "$local_md5" ]
}

ensure_uploaded_file() {
  local file="$1"
  local key="$2"

  if remote_object_matches_file "$file" "$key"; then
    echo "Skipping already uploaded file: $key"
    return
  fi

  upload_file "$file" "$key"
}

upload_file() {
  local file="$1"
  local key="$2"

  echo "Uploading: $key"
  curl --fail --silent --show-error --ipv4 \
    "${CURL_RETRY_ARGS[@]}" \
    --aws-sigv4 "aws:amz:us-east-1:s3" \
    --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" \
    --upload-file "$file" \
    "$(object_url "$key")"
}

generate_version_json() {
  local release_dir="$1"
  local version="$2"
  local public_base_url="$3"
  local output_file="$4"

  node - "$release_dir" "$version" "$public_base_url" "$output_file" <<'EOF'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const releaseDir = process.argv[2];
const version = process.argv[3];
const publicBaseUrl = process.argv[4].replace(/\/+$/, "");
const outputFile = process.argv[5];

const exists = (name) => fs.existsSync(path.join(releaseDir, name));
const toUrl = (name) => `${publicBaseUrl}/${version}/${name}`;
async function hashFile(name) {
  const filePath = path.join(releaseDir, name);
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function fileSize(name) {
  return fs.statSync(path.join(releaseDir, name)).size;
}

async function artifact(name) {
  return {
    main: toUrl(name),
    install: toUrl(name),
    mainSha256: await hashFile(name),
    installSha256: await hashFile(name),
    mainSize: fileSize(name),
    installSize: fileSize(name),
  };
}

async function main() {
const manifest = { version };

if (exists("ladonx_amd64.dmg")) manifest.mac_amd_64 = await artifact("ladonx_amd64.dmg");
if (exists("ladonx_arm64.dmg")) manifest.mac_arm_64 = await artifact("ladonx_arm64.dmg");

if (exists("windows_amd64_portable/ladonx.exe")) {
  const portableZip = "ladonx_amd64_portable.zip";
  manifest.win_amd_64 = {
    main: exists(portableZip) ? toUrl(portableZip) : toUrl("windows_amd64_portable/ladonx.exe"),
    portableZip: exists(portableZip) ? toUrl(portableZip) : undefined,
    daemon: toUrl("windows_amd64_portable/ladonx_daemon.exe"),
    daemonctl: toUrl("windows_amd64_portable/ladonx_daemonctl.exe"),
    install: exists("ladonx_amd64_install.msi") ? toUrl("ladonx_amd64_install.msi") : undefined,
    mainSha256: exists(portableZip) ? await hashFile(portableZip) : await hashFile("windows_amd64_portable/ladonx.exe"),
    mainSize: exists(portableZip) ? fileSize(portableZip) : fileSize("windows_amd64_portable/ladonx.exe"),
    portableZipSha256: exists(portableZip) ? await hashFile(portableZip) : undefined,
    portableZipSize: exists(portableZip) ? fileSize(portableZip) : undefined,
    installSha256: exists("ladonx_amd64_install.msi") ? await hashFile("ladonx_amd64_install.msi") : undefined,
    installSize: exists("ladonx_amd64_install.msi") ? fileSize("ladonx_amd64_install.msi") : undefined,
  };
} else if (exists("ladonx_amd64_install.msi")) {
  manifest.win_amd_64 = await artifact("ladonx_amd64_install.msi");
}

if (exists("windows_arm64_portable/ladonx.exe")) {
  const portableZip = "ladonx_arm64_portable.zip";
  manifest.win_arm_64 = {
    main: exists(portableZip) ? toUrl(portableZip) : toUrl("windows_arm64_portable/ladonx.exe"),
    portableZip: exists(portableZip) ? toUrl(portableZip) : undefined,
    daemon: toUrl("windows_arm64_portable/ladonx_daemon.exe"),
    daemonctl: toUrl("windows_arm64_portable/ladonx_daemonctl.exe"),
    install: exists("ladonx_arm64_install.msi") ? toUrl("ladonx_arm64_install.msi") : undefined,
    mainSha256: exists(portableZip) ? await hashFile(portableZip) : await hashFile("windows_arm64_portable/ladonx.exe"),
    mainSize: exists(portableZip) ? fileSize(portableZip) : fileSize("windows_arm64_portable/ladonx.exe"),
    portableZipSha256: exists(portableZip) ? await hashFile(portableZip) : undefined,
    portableZipSize: exists(portableZip) ? fileSize(portableZip) : undefined,
    installSha256: exists("ladonx_arm64_install.msi") ? await hashFile("ladonx_arm64_install.msi") : undefined,
    installSize: exists("ladonx_arm64_install.msi") ? fileSize("ladonx_arm64_install.msi") : undefined,
  };
} else if (exists("ladonx_arm64_install.msi")) {
  manifest.win_arm_64 = await artifact("ladonx_arm64_install.msi");
}

for (const value of Object.values(manifest)) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) delete value[key];
    }
  }
}

fs.writeFileSync(
  outputFile,
  JSON.stringify(manifest, null, 2) + "\n",
);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
EOF
}

verify_public_url() {
  local url="$1"
  curl --fail --silent --show-error --ipv4 \
    "${CURL_RETRY_ARGS[@]}" \
    -I \
    "$url" >/dev/null
}

RELEASE_DIR_INPUT="${1:-}"

if RELEASE_DIR="$(resolve_release_dir "$RELEASE_DIR_INPUT")"; then
  :
elif [ -n "$RELEASE_DIR_INPUT" ]; then
  echo "Release directory not found: $RELEASE_DIR_INPUT" >&2
  exit 1
else
  RELEASE_DIR="$(build_desktop_release)"
fi

RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
VERSION="$(basename "$RELEASE_DIR")"
VERSION_JSON_FILE="$(mktemp -t ladonx-version-json)"
trap 'rm -f "$VERSION_JSON_FILE"' EXIT

while IFS= read -r file; do
  relative="${file#"$RELEASE_DIR"/}"
  [ "$(basename "$relative")" = ".DS_Store" ] && continue
  [ "$relative" = "version.json" ] && continue
  ensure_uploaded_file "$file" "$(object_key "$VERSION/$relative")"
done < <(find "$RELEASE_DIR" -type f -print | sort)

while IFS= read -r file; do
  relative="${file#"$RELEASE_DIR"/}"
  [ "$(basename "$relative")" = ".DS_Store" ] && continue
  [ "$relative" = "version.json" ] && continue
  verify_public_url "$R2_PUBLIC_BASE_URL/$VERSION/$relative"
done < <(find "$RELEASE_DIR" -type f -print | sort)

generate_version_json "$RELEASE_DIR" "$VERSION" "$R2_PUBLIC_BASE_URL" "$VERSION_JSON_FILE"

ensure_uploaded_file "$VERSION_JSON_FILE" "$(object_key version.json)"

echo "Uploaded release: $VERSION"
