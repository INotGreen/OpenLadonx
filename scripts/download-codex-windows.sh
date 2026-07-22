#!/bin/bash

set -e

CODEX_REGISTRY="${CODEX_REGISTRY:-https://registry.npmmirror.com}"

CODEX_VERSION="${CODEX_VERSION:-$(npm view @openai/codex version --registry "$CODEX_REGISTRY")}"

download_for_arch() {
  local windows_arch="$1"
  local codez_platform="$2"
  local resource_cli_exe="src-tauri/resources/windows/$windows_arch/codex.exe"
  local resource_rg_exe="src-tauri/resources/windows/$windows_arch/rg.exe"
  local resource_dir
  resource_dir="$(dirname "$resource_cli_exe")"

  mkdir -p "$resource_dir"

  if [ -n "${CODEX_EXE:-}" ] && [ -f "$CODEX_EXE" ]; then
    echo "Using local Codex CLI for $windows_arch: $CODEX_EXE"
    cp "$CODEX_EXE" "$resource_cli_exe"

    if [ -n "${CODEX_RG_EXE:-}" ] && [ -f "$CODEX_RG_EXE" ]; then
      echo "Using local ripgrep for $windows_arch: $CODEX_RG_EXE"
      cp "$CODEX_RG_EXE" "$resource_rg_exe"
    elif [ ! -f "$resource_rg_exe" ]; then
      echo "ERROR: missing $resource_rg_exe"
      echo "Set CODEX_RG_EXE to a Windows rg.exe when using CODEX_EXE."
      exit 1
    fi
  else
    local codez_package="@openai/codex@$CODEX_VERSION-$codez_platform"
    local download_dir
    download_dir="$(mktemp -d)"

    cleanup_download() {
      rm -rf "$download_dir"
    }
    trap cleanup_download RETURN

    echo "Downloading Codex CLI: $codez_package"
    echo "Registry: $CODEX_REGISTRY"
    npm pack "$codez_package" --registry "$CODEX_REGISTRY" --pack-destination "$download_dir" >/dev/null
    local codez_tarball
    codez_tarball="$(find "$download_dir" -name '*.tgz' -print -quit)"

    tar -xzf "$codez_tarball" -C "$download_dir"
    local downloaded_codex_exe
    downloaded_codex_exe="$(find "$download_dir/package" -name 'codex.exe' -type f -print -quit)"
    if [ -z "$downloaded_codex_exe" ]; then
      echo "ERROR: downloaded Codex package does not contain codex.exe"
      exit 1
    fi

    cp "$downloaded_codex_exe" "$resource_cli_exe"

    local downloaded_rg_exe
    downloaded_rg_exe="$(find "$download_dir/package" -path '*/codex-path/rg.exe' -type f -print -quit)"
    if [ -z "$downloaded_rg_exe" ]; then
      echo "ERROR: downloaded Codex package does not contain codex-path/rg.exe"
      exit 1
    fi

    cp "$downloaded_rg_exe" "$resource_rg_exe"
  fi

  for file in config.toml AGENTS.md; do
    if [ -f "$resource_dir/$file" ]; then
      continue
    fi

    if [ -f "src-tauri/resources/windows/x64/$file" ]; then
      cp "src-tauri/resources/windows/x64/$file" "$resource_dir/$file"
    elif [ -f "src-tauri/resources/macos/x64/$file" ]; then
      cp "src-tauri/resources/macos/x64/$file" "$resource_dir/$file"
    fi
  done

  echo "CLI saved to: $resource_cli_exe"
  echo "ripgrep saved to: $resource_rg_exe"
}

download_for_arch "x64" "win32-x64"
download_for_arch "arm64" "win32-arm64"
