#!/usr/bin/env python3
"""
parallel_release.py — Parallel build & upload for LadonX desktop releases.

Builds macOS DMG and Windows MSI for amd64/arm64 concurrently,
then uploads all artifacts to Cloudflare R2 in parallel.
No zip archives are produced — only .dmg and .msi installers.

Usage:
    python3 tools/parallel_release.py                          # build all + upload
    python3 tools/parallel_release.py --build-only             # build only
    python3 tools/parallel_release.py --upload-only            # upload latest
    python3 tools/parallel_release.py --targets mac-arm64      # specific targets
    python3 tools/parallel_release.py --workers 2              # limit parallelism
"""
from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent  # Client/
TAURI_CONFIG_PATH = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML_PATH = ROOT / "src-tauri" / "Cargo.toml"

# ── Target definitions ─────────────────────────────────────────────

ALL_TARGETS = {
    "mac-amd64": {"platform": "mac", "arch": "amd64", "rust": "x86_64-apple-darwin"},
    "mac-arm64": {"platform": "mac", "arch": "arm64", "rust": "aarch64-apple-darwin"},
    "win-amd64": {"platform": "win", "arch": "amd64", "rust": "x86_64-pc-windows-gnu"},
    "win-arm64": {"platform": "win", "arch": "arm64", "rust": "aarch64-pc-windows-gnullvm"},
}

# ── R2 defaults (override via env or .r2-upload.local) ─────────────

R2_DEFAULTS = {
    "endpoint": "https://6574805ffed382ca64a880212f02a7d3.r2.cloudflarestorage.com",
    "bucket": "www",
    "access_key": "952e633bd7a347ab4e6c2e25109da804",
    "secret_key": "7ca842fdb02d44e34d5a8a29f02818724f5bea7733cce7b34a00eca971bc16b4",
    "prefix": "ladonxbin",
    "public_base": "https://pub-cee1ec26d75f4f07bbd449bed039a36b.r2.dev/ladonxbin",
}


# ── Helpers ────────────────────────────────────────────────────────

def log(tag: str, msg: str):
    print(f"[{tag}] {msg}", flush=True)


def run(cmd, **kwargs):
    """Run a command, raising on failure."""
    display = " ".join(str(c) for c in cmd) if isinstance(cmd, (list, tuple)) else str(cmd)
    log("CMD", display)
    return subprocess.run(cmd, check=True, **kwargs)


def get_version() -> str:
    pkg = json.loads((ROOT / "package.json").read_text())
    return pkg["version"]


def load_r2_config() -> dict:
    """Load R2 config from .r2-upload.local env file, then env vars, then defaults."""
    cfg = dict(R2_DEFAULTS)
    env_file = ROOT / ".r2-upload.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))

    for key, env_name in [
        ("endpoint", "R2_ENDPOINT"),
        ("bucket", "R2_BUCKET"),
        ("access_key", "R2_ACCESS_KEY_ID"),
        ("secret_key", "R2_SECRET_ACCESS_KEY"),
        ("prefix", "R2_PREFIX"),
        ("public_base", "R2_PUBLIC_BASE_URL"),
    ]:
        cfg[key] = os.environ.get(env_name, cfg[key])
    return cfg


def _replace_cargo_version(text: str, version: str) -> str:
    return re.sub(
        r'(?ms)^(\[package\]\s+name\s*=\s*"[^"]+"\s+version\s*=\s*")[^"]+(")',
        rf"\g<1>{version}\2",
        text,
        count=1,
    )


@contextlib.contextmanager
def temporary_release_version(version: str):
    """Temporarily stamp Tauri/Cargo version metadata for this build."""
    cargo_original = CARGO_TOML_PATH.read_text()
    tauri_original = TAURI_CONFIG_PATH.read_text()
    tauri_config = json.loads(tauri_original)
    try:
        updated_cargo = _replace_cargo_version(cargo_original, version)
        if updated_cargo == cargo_original:
            raise RuntimeError(f"Unable to update version in {CARGO_TOML_PATH}")
        CARGO_TOML_PATH.write_text(updated_cargo)

        tauri_config["version"] = version
        tauri_build = tauri_config.setdefault("build", {})
        tauri_build["beforeBuildCommand"] = ""
        TAURI_CONFIG_PATH.write_text(json.dumps(tauri_config, indent=2) + "\n")
        yield
    finally:
        CARGO_TOML_PATH.write_text(cargo_original)
        TAURI_CONFIG_PATH.write_text(tauri_original)


# ── Builder ────────────────────────────────────────────────────────

class Builder:
    """Runs Tauri builds for individual targets in parallel."""

    def __init__(self, release_version: str, out_dir: Path, workers: int):
        self.release_version = release_version
        self.out_dir = out_dir
        self.workers = workers
        self.icon_file = ROOT / "src-tauri" / "icons" / "icon.ico"
        self.llvm_mingw_home = os.environ.get(
            "LLVM_MINGW_HOME", str(ROOT / ".toolchains" / "llvm-mingw")
        )

    def _build_env(self) -> dict:
        env = dict(os.environ)
        env["BUILD_VERSION"] = self.release_version
        return env

    def build_target(self, target_name: str) -> tuple[str, bool, str]:
        info = ALL_TARGETS[target_name]
        t0 = time.monotonic()
        try:
            if info["platform"] == "mac":
                self._build_mac(info["arch"], info["rust"])
            else:
                self._build_win(info["arch"], info["rust"])
            elapsed = time.monotonic() - t0
            log("BUILD", f"✓ {target_name} ({elapsed:.0f}s)")
            return (target_name, True, "")
        except Exception as e:
            return (target_name, False, str(e))

    # ── macOS ──────────────────────────────────────────────────────

    def _build_mac(self, arch: str, rust_target: str):
        app_bundle_dir = ROOT / "src-tauri" / "target" / rust_target / "release" / "bundle" / "macos"
        app_bundle_dir.mkdir(parents=True, exist_ok=True)
        env = self._build_env()

        # Clean stale .app bundles
        for p in app_bundle_dir.glob("*.app"):
            shutil.rmtree(p, ignore_errors=True)

        run(
            ["npm", "run", "tauri", "--", "build",
             "--target", rust_target, "--bundles", "app"],
            cwd=ROOT, env=env,
        )

        apps = [p for p in app_bundle_dir.iterdir() if p.is_dir() and p.suffix == ".app"]
        if not apps:
            raise RuntimeError(f"No .app bundle in {app_bundle_dir}")
        app_bundle = apps[0]

        # Ad-hoc codesign
        run(["codesign", "--force", "--deep", "--sign", "-", str(app_bundle)])
        run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app_bundle)])

        # Create DMG
        dmg_path = self.out_dir / f"ladonx_{arch}.dmg"
        dmg_path.unlink(missing_ok=True)

        staging = Path(tempfile.mkdtemp(prefix="ladonx-dmg-"))
        try:
            shutil.copytree(app_bundle, staging / app_bundle.name)
            os.symlink("/Applications", staging / "Applications")
            run([
                "hdiutil", "create",
                "-volname", "LadonX",
                "-srcfolder", str(staging),
                "-ov", "-format", "UDZO",
                str(dmg_path),
            ])
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    # ── Windows ────────────────────────────────────────────────────

    def _build_win(self, arch: str, rust_target: str):
        release_dir = ROOT / "src-tauri" / "target" / rust_target / "release"
        portable_dir = release_dir / "portable"

        env = self._build_env()
        if arch == "arm64":
            llvm_bin = Path(self.llvm_mingw_home) / "bin"
            if llvm_bin.is_dir():
                env["PATH"] = f"{llvm_bin}:{env.get('PATH', '')}"
            env.update({
                "CMAKE_SYSTEM_PROCESSOR": "aarch64",
                "WHISPER_NO_AVX": "ON", "WHISPER_NO_AVX2": "ON",
                "WHISPER_NO_AVX512": "ON", "WHISPER_NO_AVX512_VBMI": "ON",
                "WHISPER_NO_AVX512_VNNI": "ON", "WHISPER_NO_FMA": "ON",
                "WHISPER_NO_F16C": "ON",
            })

        run(
            ["npm", "run", "tauri", "--", "build",
             "--config", "src-tauri/tauri.windows.conf.json",
             "--target", rust_target, "--no-bundle"],
            cwd=ROOT, env=env,
        )

        # Stage files for MSI
        if portable_dir.exists():
            shutil.rmtree(portable_dir)
        portable_dir.mkdir(parents=True)

        for name in ["ladonx.exe", "ladonx_daemon.exe", "ladonx_daemonctl.exe", "WebView2Loader.dll"]:
            src = release_dir / name
            if not src.exists():
                raise RuntimeError(f"Missing {name} in {release_dir}")
            shutil.copy2(src, portable_dir / name)

        self._copy_runtime_dlls(arch, portable_dir, env)

        if not (portable_dir / "libwinpthread-1.dll").exists():
            raise RuntimeError("Missing libwinpthread-1.dll after DLL copy")

        # MSI only — no zip
        msi_path = self.out_dir / f"ladonx_{arch}_install.msi"
        self._make_msi(arch, portable_dir, msi_path)

    def _copy_runtime_dlls(self, arch: str, dest: Path, env: dict):
        if arch == "amd64":
            cc, triplet = "x86_64-w64-mingw32-gcc", "x86_64-w64-mingw32"
        else:
            cc, triplet = "aarch64-w64-mingw32-clang", "aarch64-w64-mingw32"

        cc_path = shutil.which(cc, path=env.get("PATH", ""))
        if not cc_path:
            return

        tool_root = Path(cc_path).resolve().parent.parent
        dlls = [
            "libstdc++-6.dll", "libgcc_s_seh-1.dll", "libgcc_s_dw2-1.dll",
            "libwinpthread-1.dll", "libc++.dll", "libc++abi.dll", "libunwind.dll",
        ]

        for dll in dlls:
            # Ask the compiler where the DLL lives
            try:
                r = subprocess.run([cc, f"-print-file-name={dll}"],
                                   capture_output=True, text=True, env=env)
                p = r.stdout.strip()
                if p and Path(p).is_file():
                    shutil.copy2(p, dest / dll)
                    continue
            except Exception:
                pass

            # Fallback: search known locations
            candidates = [
                tool_root / triplet / "bin" / dll,
                tool_root / triplet / "lib" / dll,
                Path(self.llvm_mingw_home) / triplet / "bin" / dll,
                Path(self.llvm_mingw_home) / triplet / "lib" / dll,
                Path(self.llvm_mingw_home) / "bin" / dll,
                Path(self.llvm_mingw_home) / "lib" / dll,
                tool_root / "bin" / dll,
                Path(f"/usr/{triplet}/bin/{dll}"),
                Path(f"/usr/{triplet}/lib/{dll}"),
            ]
            for c in candidates:
                if c.is_file():
                    shutil.copy2(c, dest / dll)
                    break

    @staticmethod
    def _wixl_supports_arm64() -> bool:
        """Check if the installed wixl binary has arm64 support baked in."""
        wixl = shutil.which("wixl")
        if not wixl:
            return False
        try:
            data = Path(wixl).read_bytes()
            return b"WIXL_ARCH_ARM64" in data
        except Exception:
            return False

    def _make_msi(self, arch: str, portable_dir: Path, output: Path):
        wix_arch = "x64" if arch == "amd64" else "arm64"

        fd, wxs_path = tempfile.mkstemp(suffix=".wxs", prefix="ladonx-msi-")
        os.close(fd)
        try:
            self._generate_wxs(portable_dir, wxs_path)

            pkg_ver = json.loads((ROOT / "package.json").read_text())["version"]
            msi_ver = ".".join(pkg_ver.split(".")[:3])

            # wixl < 0.107 doesn't support -a arm64; build as x64 then patch
            if arch == "arm64" and not self._wixl_supports_arm64():
                log("BUILD", "wixl lacks arm64 support, patching via msibuild")
                run([
                    "wixl", "-a", "x64", "--ext", "ui",
                    "-o", str(output),
                    "-D", f"PortableDir={portable_dir}",
                    "-D", f"IconFile={self.icon_file}",
                    "-D", f"ProductVersion={msi_ver}",
                    wxs_path,
                ])
                # Extract the ProductCode UUID from MSI Summary Information
                r = subprocess.run(
                    ["msiinfo", "export", str(output), "_SummaryInformation"],
                    capture_output=True, text=True, check=True,
                )
                uuid = ""
                for line in r.stdout.splitlines():
                    parts = line.split("\t")
                    if len(parts) >= 2 and parts[0] == "9":
                        uuid = parts[1]
                        break
                # Patch the MSI to declare arm64 architecture
                run(["msibuild", str(output), "-s",
                     "LadonX", "LadonX", "Arm64;1033", uuid])
            else:
                run([
                    "wixl", "-a", wix_arch, "--ext", "ui",
                    "-o", str(output),
                    "-D", f"PortableDir={portable_dir}",
                    "-D", f"IconFile={self.icon_file}",
                    "-D", f"ProductVersion={msi_ver}",
                    wxs_path,
                ])
        finally:
            Path(wxs_path).unlink(missing_ok=True)

    @staticmethod
    def _generate_wxs(portable_dir: Path, wxs_path: str):
        files = sorted(f.name for f in portable_dir.iterdir() if f.is_file())
        for req in ["ladonx.exe", "ladonx_daemon.exe", "ladonx_daemonctl.exe", "WebView2Loader.dll"]:
            if req not in files:
                raise RuntimeError(f"Missing {req} in {portable_dir}")

        entries = []
        for i, name in enumerate(files):
            safe_id = re.sub(r"[^A-Za-z0-9_]", "_", name)
            kp = ' KeyPath="yes"' if name == "ladonx.exe" else ""
            entries.append(
                f'        <File Id="File_{i}_{safe_id}" '
                f'Source="$(var.PortableDir)/{name}"{kp} />'
            )
        xml = "\n".join(entries)

        wxs = f'''<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="LadonX" Language="1033" Version="$(var.ProductVersion)"
           Manufacturer="LadonX" UpgradeCode="{{07E3C7E0-9EFC-408E-87F5-712FDE4705BE}}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser" />
    <MajorUpgrade AllowSameVersionUpgrades="yes"
                  DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
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
      <Component Id="PortableFilesComponent" Guid="{{77AFE239-35A0-4650-8801-5E738DF67973}}" Win64="yes">
{xml}
      </Component>
    </DirectoryRef>
  </Product>
  <Fragment>
    <UI>
      <TextStyle Id="WixUI_Font_Normal" FaceName="Tahoma" Size="8" />
      <TextStyle Id="WixUI_Font_Bigger" FaceName="Tahoma" Size="12" />
      <Property Id="DefaultUIFont" Value="WixUI_Font_Normal" />
      <DialogRef Id="ErrorDlg" /><DialogRef Id="CancelDlg" />
      <DialogRef Id="ExitDialog" /><DialogRef Id="FatalError" />
      <DialogRef Id="FilesInUse" /><DialogRef Id="MsiRMFilesInUse" />
      <DialogRef Id="OutOfDiskDlg" /><DialogRef Id="OutOfRbDiskDlg" />
      <DialogRef Id="PrepareDlg" /><DialogRef Id="ProgressDlg" />
      <DialogRef Id="ResumeDlg" /><DialogRef Id="UserExit" />
      <DialogRef Id="WelcomeDlg" /><DialogRef Id="VerifyReadyDlg" />
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
      <Component Id="DesktopShortcutComponent" Guid="{{242FC8A6-FB3C-42B4-8C16-42485EA02B78}}">
        <Shortcut Id="DesktopShortcut" Name="LadonX" Description="Launch LadonX"
                  Target="[INSTALLDIR]ladonx.exe" WorkingDirectory="INSTALLDIR"
                  Icon="LadonXIcon" IconIndex="0" />
        <RegistryValue Root="HKCU" Key="Software\\LadonX" Name="DesktopShortcut"
                       Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </DirectoryRef>
  </Fragment>
</Wix>'''
        Path(wxs_path).write_text(wxs)

    # ── Orchestration ──────────────────────────────────────────────

    def build_all(self, targets: list[str]):
        self.out_dir.mkdir(parents=True, exist_ok=True)
        results: list[tuple[str, bool, str]] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.workers) as pool:
            futs = {pool.submit(self.build_target, t): t for t in targets}
            for fut in concurrent.futures.as_completed(futs):
                name, ok, err = fut.result()
                results.append((name, ok, err))
                if not ok:
                    log("BUILD", f"✗ {name}: {err}")

        failed = [(n, e) for n, ok, e in results if not ok]
        if failed:
            detail = "\n".join(f"  {n}: {e}" for n, e in failed)
            raise RuntimeError(f"Build failed:\n{detail}")

        log("BUILD", f"All {len(results)} target(s) built → {self.out_dir}")


# ── Uploader ───────────────────────────────────────────────────────

class Uploader:
    """Uploads release artifacts to Cloudflare R2 in parallel."""

    CURL_RETRY = ["--retry", "5", "--retry-delay", "2", "--retry-all-errors"]

    def __init__(self, release_dir: Path, r2_cfg: dict, workers: int = 4):
        self.release_dir = release_dir
        self.r2 = r2_cfg
        self.workers = workers

    # ── R2 helpers ─────────────────────────────────────────────────

    def _object_key(self, relative: str) -> str:
        prefix = self.r2["prefix"].rstrip("/")
        return f"{prefix}/{relative}" if prefix else relative

    def _object_url(self, key: str) -> str:
        ep = self.r2["endpoint"].rstrip("/")
        bucket = self.r2["bucket"]
        encoded = "/".join(urllib.parse.quote(p, safe="") for p in key.split("/"))
        return f"{ep}/{bucket}/{encoded}"

    def _auth_args(self) -> list[str]:
        return [
            "--aws-sigv4", "aws:amz:us-east-1:s3",
            "--user", f"{self.r2['access_key']}:{self.r2['secret_key']}",
        ]

    # ── File hashing ───────────────────────────────────────────────

    @staticmethod
    def _hash(path: Path, algo: str) -> str:
        h = hashlib.new(algo)
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    # ── Single-file upload ─────────────────────────────────────────

    def _remote_matches(self, local_path: Path, key: str) -> bool:
        """HEAD the remote object and compare size + ETag/MD5."""
        try:
            r = subprocess.run(
                ["curl", "--silent", "--show-error", "--ipv4",
                 *self.CURL_RETRY[:3],  # lighter retry for HEAD
                 *self._auth_args(), "-I",
                 self._object_url(key)],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode != 0:
                return False

            remote_size = remote_etag = None
            for line in r.stdout.splitlines():
                low = line.lower()
                if low.startswith("content-length:"):
                    remote_size = line.split(":", 1)[1].strip().rstrip("\r")
                elif low.startswith("etag:"):
                    remote_etag = line.split(":", 1)[1].strip().rstrip("\r").strip('"')

            if remote_size != str(local_path.stat().st_size):
                return False
            if remote_etag and remote_etag != self._hash(local_path, "md5"):
                return False
            return True
        except Exception:
            return False

    def _upload_one(self, local_path: Path, key: str) -> bool:
        """Upload one file; return True if actually uploaded."""
        if self._remote_matches(local_path, key):
            log("UPLOAD", f"⏭ skip {key}")
            return False

        log("UPLOAD", f"↑ {key} ({local_path.stat().st_size / 1048576:.1f} MB)")
        subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--ipv4",
             *self.CURL_RETRY, *self._auth_args(),
             "--upload-file", str(local_path),
             self._object_url(key)],
            check=True, timeout=600,
        )
        return True

    # ── Collect & upload all ───────────────────────────────────────

    def _collect_files(self) -> list[tuple[Path, str]]:
        items = []
        for p in sorted(self.release_dir.rglob("*")):
            if not p.is_file() or p.name == ".DS_Store":
                continue
            items.append((p, str(p.relative_to(self.release_dir))))
        return items

    def upload_all(self):
        version = self.release_dir.name
        files = self._collect_files()
        log("UPLOAD", f"{len(files)} file(s) in {version}")

        def _do(item: tuple[Path, str]):
            path, rel = item
            key = self._object_key(f"{version}/{rel}")
            self._upload_one(path, key)

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.workers) as pool:
            list(pool.map(_do, files))

        # Generate & upload version.json
        vj = self._generate_version_json(version)
        self._upload_one(vj, self._object_key("version.json"))
        vj.unlink(missing_ok=True)

        # Verify public URLs
        for _, rel in files:
            url = f"{self.r2['public_base']}/{version}/{rel}"
            try:
                subprocess.run(
                    ["curl", "--fail", "--silent", "--show-error", "--ipv4",
                     "-I", url],
                    capture_output=True, check=True, timeout=30,
                )
            except subprocess.CalledProcessError:
                log("UPLOAD", f"⚠ verify failed: {url}")

        log("UPLOAD", f"✓ Release {version} uploaded")

    # ── version.json ───────────────────────────────────────────────

    def _generate_version_json(self, version: str) -> Path:
        rd = self.release_dir
        base = self.r2["public_base"].rstrip("/")

        def exists(n: str) -> bool:
            return (rd / n).exists()

        def url(n: str) -> str:
            return f"{base}/{version}/{n}"

        def artifact(n: str) -> dict:
            return {
                "main": url(n),
                "install": url(n),
                "mainSha256": self._hash(rd / n, "sha256"),
                "installSha256": self._hash(rd / n, "sha256"),
                "mainSize": (rd / n).stat().st_size,
                "installSize": (rd / n).stat().st_size,
            }

        # The manifest version must match the uploaded release identifier so
        # the client can detect a new build even when package.json is unchanged.
        manifest: dict = {"version": version}
        if exists("ladonx_amd64.dmg"):
            manifest["mac_amd_64"] = artifact("ladonx_amd64.dmg")
        if exists("ladonx_arm64.dmg"):
            manifest["mac_arm_64"] = artifact("ladonx_arm64.dmg")
        if exists("ladonx_amd64_install.msi"):
            manifest["win_amd_64"] = artifact("ladonx_amd64_install.msi")
        if exists("ladonx_arm64_install.msi"):
            manifest["win_arm_64"] = artifact("ladonx_arm64_install.msi")

        fd, path = tempfile.mkstemp(suffix=".json", prefix="ladonx-version-")
        os.close(fd)
        Path(path).write_text(json.dumps(manifest, indent=2) + "\n")
        return Path(path)


# ── CLI ────────────────────────────────────────────────────────────

def resolve_release_dir(input_path: str | None) -> Path:
    """Find the release directory for upload."""
    if input_path:
        p = Path(input_path)
        if p.is_dir():
            return p.resolve()
        p = ROOT / input_path
        if p.is_dir():
            return p.resolve()
        p = ROOT / "desktop-release" / input_path
        if p.is_dir():
            return p.resolve()
        print(f"Release directory not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Auto-detect latest
    dr = ROOT / "desktop-release"
    if not dr.is_dir():
        print("No desktop-release/ directory found", file=sys.stderr)
        sys.exit(1)
    dirs = sorted(d for d in dr.iterdir() if d.is_dir())
    if not dirs:
        print("No release directories under desktop-release/", file=sys.stderr)
        sys.exit(1)
    return dirs[-1].resolve()


def main():
    ap = argparse.ArgumentParser(
        description="Parallel build & upload for LadonX desktop releases"
    )
    ap.add_argument(
        "--targets", default="mac-amd64,mac-arm64,win-amd64,win-arm64",
        help="Comma-separated build targets (default: all 4)",
    )
    ap.add_argument("--workers", type=int, default=4,
                    help="Max parallel builds (default: 4)")
    ap.add_argument("--upload-workers", type=int, default=4,
                    help="Max parallel uploads (default: 4)")
    ap.add_argument("--build-only", action="store_true",
                    help="Build without uploading")
    ap.add_argument("--upload-only", action="store_true",
                    help="Upload without building")
    ap.add_argument("--release-dir", default=None,
                    help="Release dir to upload (for --upload-only)")
    ap.add_argument("--version", default=None,
                    help="Override release version string")

    args = ap.parse_args()

    # Version & output dir
    version = args.version or get_version()
    ts = os.environ.get("BUILD_VERSION") or f"{version}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir = Path(os.environ.get("OUTPUT_DIR", str(ROOT / "desktop-release" / ts)))

    # Validate targets
    target_list = [t.strip() for t in args.targets.split(",") if t.strip()]
    for t in target_list:
        if t not in ALL_TARGETS:
            print(f"Unknown target: {t}\nAvailable: {', '.join(ALL_TARGETS)}",
                  file=sys.stderr)
            sys.exit(1)

    t_start = time.monotonic()

    # ── Build phase ────────────────────────────────────────────────
    if not args.upload_only:
        log("MAIN", f"Building {', '.join(target_list)} with {args.workers} worker(s)")
        log("MAIN", f"Output → {out_dir}")
        with temporary_release_version(ts):
            builder = Builder(ts, out_dir, args.workers)
            run(["npm", "run", "build"], cwd=ROOT, env=builder._build_env())
            builder.build_all(target_list)

    # ── Upload phase ───────────────────────────────────────────────
    if not args.build_only:
        release_dir = resolve_release_dir(
            args.release_dir if args.upload_only else str(out_dir)
        )
        r2_cfg = load_r2_config()
        log("MAIN", f"Uploading {release_dir} → R2 ({args.upload_workers} worker(s))")
        uploader = Uploader(release_dir, r2_cfg, args.upload_workers)
        uploader.upload_all()

    elapsed = time.monotonic() - t_start
    log("MAIN", f"All done in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
