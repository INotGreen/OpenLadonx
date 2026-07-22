#!/bin/bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
RELEASE_VERSION="${BUILD_VERSION:-${VERSION}-$(date +%Y%m%d-%H%M%S)}"
export BUILD_VERSION="$RELEASE_VERSION"
OUT_DIR="${OUTPUT_DIR:-$ROOT/desktop-release/$RELEASE_VERSION}"
BASE_URL="${RELEASE_BASE_URL:-}"
ICON_FILE="$ROOT/src-tauri/icons/icon.ico"
LLVM_MINGW_HOME="${LLVM_MINGW_HOME:-$ROOT/.toolchains/llvm-mingw}"
BUILD_WINDOWS_LOCAL="${BUILD_WINDOWS_LOCAL:-0}"
WINDOWS_AMD64_BUILT=0
MACOS_SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:-${CODESIGN_IDENTITY:-${APPLE_SIGNING_IDENTITY:-}}}"
MACOS_NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-${APPLE_NOTARY_PROFILE:-}}"
TAURI_CONFIG_FILE="$ROOT/src-tauri/tauri.conf.json"
CARGO_TOML_FILE="$ROOT/src-tauri/Cargo.toml"
TAURI_CONFIG_BACKUP="$(mktemp -t ladonx-tauri-conf)"
CARGO_TOML_BACKUP="$(mktemp -t ladonx-cargo-toml)"

cp "$TAURI_CONFIG_FILE" "$TAURI_CONFIG_BACKUP"
cp "$CARGO_TOML_FILE" "$CARGO_TOML_BACKUP"

restore_release_version() {
  cp "$TAURI_CONFIG_BACKUP" "$TAURI_CONFIG_FILE"
  cp "$CARGO_TOML_BACKUP" "$CARGO_TOML_FILE"
  rm -f "$TAURI_CONFIG_BACKUP" "$CARGO_TOML_BACKUP"
}

stamp_release_version() {
  node - "$RELEASE_VERSION" "$TAURI_CONFIG_FILE" "$CARGO_TOML_FILE" <<'EOF'
const fs = require("fs");

const version = process.argv[2];
const tauriConfigFile = process.argv[3];
const cargoTomlFile = process.argv[4];

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigFile, "utf8"));
tauriConfig.version = version;
fs.writeFileSync(tauriConfigFile, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = fs.readFileSync(cargoTomlFile, "utf8");
const updatedCargoToml = cargoToml.replace(
  /^(\[package\][\s\S]*?^name\s*=\s*"[^"]+"\nversion\s*=\s*")[^"]+(")$/m,
  `$1${version}$2`,
);

if (updatedCargoToml === cargoToml) {
  throw new Error(`Unable to update version in ${cargoTomlFile}`);
}

fs.writeFileSync(cargoTomlFile, updatedCargoToml);
EOF
}

trap restore_release_version EXIT
stamp_release_version

win_target() {
  [ "$1" = "amd64" ] && echo "x86_64-pc-windows-gnu" || echo "${WINDOWS_ARM64_TARGET:-aarch64-pc-windows-gnullvm}"
}

mac_target() {
  [ "$1" = "amd64" ] && echo "x86_64-apple-darwin" || echo "aarch64-apple-darwin"
}

msi_version() {
  node <<'EOF'
const v = require("./package.json").version.split(".").slice(0, 3);
if (v.length !== 3 || v.some((x) => !/^\d+$/.test(x))) throw new Error("invalid MSI version");
process.stdout.write(v.join("."));
EOF
}

ref() {
  if [ -n "$BASE_URL" ]; then
    printf '%s/%s' "${BASE_URL%/}" "$1"
  else
    printf '%s' "$1"
  fi
}

require_file() {
  [ -f "$1" ] || { echo "ERROR: missing file $1"; exit 1; }
}

require_dir() {
  [ -d "$1" ] || { echo "ERROR: missing directory $1"; exit 1; }
}

ensure_macos_signing_config() {
  if [ -n "$MACOS_SIGN_IDENTITY" ]; then
    return 0
  fi
}

verify_macos_app() {
  local app_path="$1"

  require_dir "$app_path"
  codesign --verify --deep --strict --verbose=2 "$app_path"
}

adhoc_sign_macos_app() {
  local app_path="$1"

  require_dir "$app_path"
  codesign --force --deep --sign - "$app_path"
}

maybe_notarize_macos_dmg() {
  local dmg_path="$1"

  if [ -z "$MACOS_NOTARY_PROFILE" ]; then
    return 0
  fi

  require_file "$dmg_path"
  xcrun notarytool submit "$dmg_path" --wait --keychain-profile "$MACOS_NOTARY_PROFILE"
  xcrun stapler staple "$dmg_path"
}

archive_app_bundle() {
  local app_bundle="$1"
  local archive_file="$2"

  require_dir "$app_bundle"
  rm -f "$archive_file"
  ditto -c -k --keepParent "$app_bundle" "$archive_file"
}

create_macos_dmg() {
  local app_bundle="$1"
  local dmg_file="$2"
  local staging_dir

  require_dir "$app_bundle"
  rm -f "$dmg_file"
  staging_dir="$(mktemp -d -t ladonx-dmg)"
  cp -R "$app_bundle" "$staging_dir/"
  ln -s /Applications "$staging_dir/Applications"
  hdiutil create -volname "LadonX" -srcfolder "$staging_dir" -ov -format UDZO "$dmg_file"
  rm -rf "$staging_dir"
}

copy_release() {
  mkdir -p "$OUT_DIR"
  cp "$1" "$OUT_DIR/$2"
}

build_mac() {
  local arch="$1"
  local target
  local app_bundle
  local app_bundle_dir
  local app_name

  ensure_macos_signing_config
  target="$(mac_target "$arch")"
  app_bundle_dir="$ROOT/src-tauri/target/$target/release/bundle/macos"
  mkdir -p "$app_bundle_dir"
  rm -rf "$app_bundle_dir"/*.app

  npm run tauri -- build --target "$target" --bundles app
  app_bundle="$(find "$app_bundle_dir" -maxdepth 1 -type d -name '*.app' | head -n 1)"
  app_name="ladonx_${arch}.dmg"
  require_dir "$app_bundle"
  if [ -n "$MACOS_SIGN_IDENTITY" ] && [ -n "$app_bundle" ] && [ -d "$app_bundle" ]; then
    verify_macos_app "$app_bundle"
  else
    adhoc_sign_macos_app "$app_bundle"
    verify_macos_app "$app_bundle"
  fi
  rm -f "$OUT_DIR/$app_name"
  create_macos_dmg "$app_bundle" "$OUT_DIR/$app_name"
}

copy_runtime_dlls() {
  local arch="$1"
  local dir="$2"
  local cc triplet dll path tool_root

  if [ "$arch" = "amd64" ]; then
    cc="x86_64-w64-mingw32-gcc"
    triplet="x86_64-w64-mingw32"
  else
    cc="aarch64-w64-mingw32-clang"
    triplet="aarch64-w64-mingw32"
  fi

  command -v "$cc" >/dev/null 2>&1 || return 0
  tool_root="$(cd "$(dirname "$(command -v "$cc")")/.." && pwd)"

  for dll in \
    libstdc++-6.dll \
    libgcc_s_seh-1.dll \
    libgcc_s_dw2-1.dll \
    libwinpthread-1.dll \
    libc++.dll \
    libc++abi.dll \
    libunwind.dll; do
    path="$("$cc" -print-file-name="$dll")"
    if [ -f "$path" ]; then
      cp "$path" "$dir/"
      continue
    fi
    for path in \
      "$tool_root/$triplet/bin/$dll" \
      "$tool_root/$triplet/lib/$dll" \
      "$LLVM_MINGW_HOME/$triplet/bin/$dll" \
      "$LLVM_MINGW_HOME/$triplet/lib/$dll" \
      "$LLVM_MINGW_HOME/bin/$dll" \
      "$LLVM_MINGW_HOME/lib/$dll" \
      "$tool_root/bin/$dll" \
      "/usr/$triplet/bin/$dll" \
      "/usr/$triplet/lib/$dll"; do
      [ -f "$path" ] && cp "$path" "$dir/" && break
    done
  done

  return 0
}

require_windows_runtime() {
  local dir="$1"
  local dll="$2"

  [ -f "$dir/$dll" ] || {
    echo "ERROR: missing Windows runtime dependency $dll in $dir"
    exit 1
  }
}

archive_portable_dir() {
  local source_dir="$1"
  local archive_file="$2"

  rm -f "$archive_file"
  (
    cd "$(dirname "$source_dir")"
    ditto -c -k --keepParent "$(basename "$source_dir")" "$archive_file"
  )
}

make_portable_msi() {
  local arch="$1"
  local portable_dir="$2"
  local out_file="$3"
  local wix_arch wxs uuid

  [ "$arch" = "amd64" ] && wix_arch="x64" || wix_arch="arm64"
  require_file "$ICON_FILE"

  wxs="$(mktemp -t ladonx-msi).wxs"

  node - "$portable_dir" "$wxs" <<'EOF'
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const out = process.argv[3];
const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
for (const name of ["ladonx.exe", "ladonx_daemon.exe", "ladonx_daemonctl.exe", "WebView2Loader.dll"]) {
  if (!files.includes(name)) throw new Error(`missing ${name}`);
}
const xml = files.map((name, i) => {
  const id = `File_${i}_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const key = name === "ladonx.exe" ? ' KeyPath="yes"' : "";
  return `        <File Id="${id}" Source="$(var.PortableDir)/${name}"${key} />`;
}).join("\n");
fs.writeFileSync(out, `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="LadonX" Language="1033" Version="$(var.ProductVersion)" Manufacturer="LadonX" UpgradeCode="{07E3C7E0-9EFC-408E-87F5-712FDE4705BE}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser" />
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" />
    <Icon Id="LadonXIcon" SourceFile="$(var.IconFile)" />
    <Property Id="ARPPRODUCTICON" Value="LadonXIcon" />
    <Property Id="WIXUI_EXITDIALOGOPTIONALTEXT" Value="LadonX has been installed successfully." />
    <Property Id="REINSTALLMODE" Value="amus" />
    <Condition Message="This installer only supports 64-bit Windows.">VersionNT64</Condition>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="AppDataFolder">
        <Directory Id="INSTALLDIR" Name="com.ladonx.app" />
      </Directory>
      <Directory Id="DesktopFolder" Name="Desktop" />
    </Directory>
    <Feature Id="ProductFeature" Title="LadonX" Level="1">
      <ComponentRef Id="PortableFilesComponent" />
      <ComponentRef Id="DesktopShortcutComponent" />
    </Feature>
    <DirectoryRef Id="INSTALLDIR">
      <Component Id="PortableFilesComponent" Guid="{77AFE239-35A0-4650-8801-5E738DF67973}" Win64="yes">
${xml}
      </Component>
    </DirectoryRef>
  </Product>
  <Fragment>
    <UI>
      <TextStyle Id="WixUI_Font_Normal" FaceName="Tahoma" Size="8" />
      <TextStyle Id="WixUI_Font_Bigger" FaceName="Tahoma" Size="12" />
      <Property Id="DefaultUIFont" Value="WixUI_Font_Normal" />

      <DialogRef Id="ErrorDlg" />
      <DialogRef Id="CancelDlg" />
      <DialogRef Id="ExitDialog" />
      <DialogRef Id="FatalError" />
      <DialogRef Id="FilesInUse" />
      <DialogRef Id="MsiRMFilesInUse" />
      <DialogRef Id="OutOfDiskDlg" />
      <DialogRef Id="OutOfRbDiskDlg" />
      <DialogRef Id="PrepareDlg" />
      <DialogRef Id="ProgressDlg" />
      <DialogRef Id="ResumeDlg" />
      <DialogRef Id="UserExit" />
      <DialogRef Id="WelcomeDlg" />
      <DialogRef Id="VerifyReadyDlg" />
      <DialogRef Id="WaitForCostingDlg" />

      <Publish Dialog="WelcomeDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="1">1</Publish>
      <Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="WelcomeDlg" Order="1">NOT Installed</Publish>
      <Publish Dialog="ExitDialog" Control="Finish" Event="EndDialog" Value="Return" Order="999">1</Publish>

      <InstallUISequence>
        <Show Dialog="WelcomeDlg" Before="ProgressDlg" Overridable="yes">NOT Installed</Show>
      </InstallUISequence>

      <AdminUISequence>
        <Show Dialog="WelcomeDlg" Before="ProgressDlg" Overridable="yes">NOT Installed</Show>
      </AdminUISequence>
    </UI>

    <UIRef Id="WixUI_Common" />
  </Fragment>
  <Fragment>
    <DirectoryRef Id="DesktopFolder">
      <Component Id="DesktopShortcutComponent" Guid="{242FC8A6-FB3C-42B4-8C16-42485EA02B78}">
        <Shortcut Id="DesktopShortcut" Name="LadonX" Description="Launch LadonX" Target="[INSTALLDIR]ladonx.exe" WorkingDirectory="INSTALLDIR" Icon="LadonXIcon" IconIndex="0" />
        <RegistryValue Root="HKCU" Key="Software\\LadonX" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </DirectoryRef>
  </Fragment>
</Wix>`);
EOF

  if [ "$arch" = "arm64" ] && ! strings "$(command -v wixl)" | grep -q 'WIXL_ARCH_ARM64'; then
    wixl -a x64 --ext ui -o "$out_file" \
      -D PortableDir="$portable_dir" \
      -D IconFile="$ICON_FILE" \
      -D ProductVersion="$(msi_version)" \
      "$wxs"
    uuid="$(msiinfo export "$out_file" _SummaryInformation | awk -F'	' '$1==9{print $2}')"
    msibuild "$out_file" -s LadonX LadonX 'Arm64;1033' "$uuid"
    rm -f "$wxs"
    return 0
  fi

  wixl -a "$wix_arch" --ext ui -o "$out_file" \
    -D PortableDir="$portable_dir" \
    -D IconFile="$ICON_FILE" \
    -D ProductVersion="$(msi_version)" \
    "$wxs"
  rm -f "$wxs"
}

build_win() {
  local arch="$1"
  local target release_dir portable_dir portable_out_dir portable_zip msi

  target="$(win_target "$arch")"
  release_dir="$ROOT/src-tauri/target/$target/release"
  portable_dir="$release_dir/portable"
  portable_out_dir="$OUT_DIR/windows_${arch}_portable"
  portable_zip="$OUT_DIR/ladonx_${arch}_portable.zip"

  if [ "$arch" = "arm64" ]; then
    if [ -d "$LLVM_MINGW_HOME/bin" ]; then
      export PATH="$LLVM_MINGW_HOME/bin:$PATH"
    fi
    command -v aarch64-w64-mingw32-clang >/dev/null 2>&1 || {
      echo "ERROR: missing aarch64-w64-mingw32-clang"
      exit 1
    }
    export CMAKE_SYSTEM_PROCESSOR="aarch64"
    export WHISPER_NO_AVX="ON"
    export WHISPER_NO_AVX2="ON"
    export WHISPER_NO_AVX512="ON"
    export WHISPER_NO_AVX512_VBMI="ON"
    export WHISPER_NO_AVX512_VNNI="ON"
    export WHISPER_NO_FMA="ON"
    export WHISPER_NO_F16C="ON"
  fi

  npm run tauri -- build --config src-tauri/tauri.windows.conf.json --target "$target" --no-bundle

  rm -rf "$portable_dir"
  mkdir -p "$portable_dir"
  for file in ladonx.exe ladonx_daemon.exe ladonx_daemonctl.exe WebView2Loader.dll; do
    require_file "$release_dir/$file"
    cp "$release_dir/$file" "$portable_dir/"
  done
  copy_runtime_dlls "$arch" "$portable_dir"
  require_windows_runtime "$portable_dir" "libwinpthread-1.dll"

  msi="ladonx_${arch}_install.msi"
  rm -rf "$portable_out_dir"
  cp -R "$portable_dir" "$portable_out_dir"
  archive_portable_dir "$portable_out_dir" "$portable_zip"
  make_portable_msi "$arch" "$portable_dir" "$OUT_DIR/$msi"
  [ "$arch" = "amd64" ] && WINDOWS_AMD64_BUILT=1
}

mkdir -p "$OUT_DIR"
build_mac amd64
build_mac arm64
build_win amd64
build_win arm64

echo "Release dir: $OUT_DIR"
