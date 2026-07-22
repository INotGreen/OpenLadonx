#!/bin/bash

set -e

CODEX_REGISTRY="${CODEX_REGISTRY:-https://registry.npmmirror.com}"

CODEX_VERSION="${CODEX_VERSION:-$(npm view @openai/codex version --registry "$CODEX_REGISTRY")}"

download_for_arch() {
  local mac_arch="$1"
  local codex_platform="$2"
  local resource_cli="src-tauri/resources/macos/$mac_arch/codex"
  local resource_rg="src-tauri/resources/macos/$mac_arch/rg"
  local resource_dir
  resource_dir="$(dirname "$resource_cli")"

  mkdir -p "$resource_dir"

  if [ -n "${CODEX_CLI:-}" ] && [ -f "$CODEX_CLI" ]; then
    echo "Using local Codex CLI for $mac_arch: $CODEX_CLI"
    cp "$CODEX_CLI" "$resource_cli"

    if [ -n "${CODEX_RG:-}" ] && [ -f "$CODEX_RG" ]; then
      echo "Using local ripgrep for $mac_arch: $CODEX_RG"
      cp "$CODEX_RG" "$resource_rg"
    elif [ ! -f "$resource_rg" ]; then
      echo "ERROR: missing $resource_rg"
      echo "Set CODEX_RG to a macOS rg binary when using CODEX_CLI."
      exit 1
    fi
  else
    local codex_package="@openai/codex@$CODEX_VERSION-$codex_platform"
    local download_dir
    download_dir="$(mktemp -d)"

    cleanup_download() {
      rm -rf "$download_dir"
    }
    trap cleanup_download RETURN

    echo "Downloading Codex CLI: $codex_package"
    echo "Registry: $CODEX_REGISTRY"
    npm pack "$codex_package" --registry "$CODEX_REGISTRY" --pack-destination "$download_dir" >/dev/null
    local codex_tarball
    codex_tarball="$(find "$download_dir" -name '*.tgz' -print -quit)"

    tar -xzf "$codex_tarball" -C "$download_dir"
    local downloaded_cli
    downloaded_cli="$(find "$download_dir/package" -name 'codex' -type f -print -quit)"
    if [ -z "$downloaded_cli" ]; then
      echo "ERROR: downloaded Codex package does not contain codex"
      exit 1
    fi

    cp "$downloaded_cli" "$resource_cli"

    local downloaded_rg
    downloaded_rg="$(find "$download_dir/package" -path '*/codex-path/rg' -type f -print -quit)"
    if [ -z "$downloaded_rg" ]; then
      echo "ERROR: downloaded Codex package does not contain codex-path/rg"
      exit 1
    fi

    cp "$downloaded_rg" "$resource_rg"
  fi

  chmod 755 "$resource_cli"
  chmod 755 "$resource_rg"

  for file in config.toml AGENTS.md; do
    if [ -f "$resource_dir/$file" ]; then
      continue
    fi

    if [ -f "src-tauri/resources/macos/x64/$file" ]; then
      cp "src-tauri/resources/macos/x64/$file" "$resource_dir/$file"
    elif [ -f "src-tauri/resources/windows/x64/$file" ]; then
      cp "src-tauri/resources/windows/x64/$file" "$resource_dir/$file"
    fi
  done

  echo "CLI saved to: $resource_cli"
  echo "ripgrep saved to: $resource_rg"
}

download_for_arch "x64" "darwin-x64"
download_for_arch "arm64" "darwin-arm64"
