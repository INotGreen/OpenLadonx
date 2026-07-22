import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAppUpdateDownload,
  downloadAppUpdate,
  fetchAppUpdateManifest,
  getAppBuildType,
  getAppUpdateDownloadStatus,
  getAppUpdatePlatformInfo,
  installAndRestartAppUpdate,
  type AppBuildType,
} from "@services/tauri";
import { subscribeAppUpdateDownload } from "@services/events";
import type {
  AppUpdateDownloadStatus,
  AppUpdatePlatformInfo,
  AppUpdateTargetKey,
  DebugEntry,
} from "../../../types";

type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "restarting"
  | "latest"
  | "error";

type UpdateProgress = {
  totalBytes?: number;
  downloadedBytes: number;
};

export type UpdateState = {
  stage: UpdateStage;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
  downloadPath?: string;
};

type PostUpdateNotice =
  | {
      stage: "loading";
      version: string;
      htmlUrl: string;
    }
  | {
      stage: "ready";
      version: string;
      body: string;
      htmlUrl: string;
    }
  | {
      stage: "fallback";
      version: string;
      htmlUrl: string;
    };

export type PostUpdateNoticeState = PostUpdateNotice | null;

type UseUpdaterOptions = {
  enabled?: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

type UpdateManifest = {
  version: string;
  mac_amd_64?: UpdateManifestArtifact;
  mac_arm_64?: UpdateManifestArtifact;
  win_amd_64?: UpdateManifestArtifact;
  win_arm_64?: UpdateManifestArtifact;
};

type UpdateManifestArtifact = {
  main?: string;
  install?: string;
  portable?: string;
  portableZip?: string;
  mainSha256?: string;
  installSha256?: string;
  portableSha256?: string;
  portableZipSha256?: string;
  mainSize?: number;
  installSize?: number;
  portableSize?: number;
  portableZipSize?: number;
};

type ResolvedUpdateAsset = {
  version: string;
  downloadUrl: string;
  fileName: string;
  targetKey: AppUpdateTargetKey;
  expectedSha256?: string;
  expectedSize?: number;
};

const UPDATE_MANIFEST_URL = "https://pub-cee1ec26d75f4f07bbd449bed039a36b.r2.dev/ladonxbin/version.json";
const UPDATE_POLL_INTERVAL_MS = 3 * 60 * 60 * 1000;

function buildDebugEntry(label: string, payload?: unknown): DebugEntry {
  return {
    id: `${Date.now()}-client-update-${label}`,
    timestamp: Date.now(),
    source: "client",
    label,
    payload,
  };
}

function normalizeVersion(value: string): string {
  return value.trim();
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const message = (error as { message: string }).message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

function resolveArtifactDownloadUrl(
  manifestUrl: string,
  version: string,
  artifactPath: string,
): string {
  const trimmedPath = artifactPath.trim();
  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  if (trimmedPath.startsWith("/")) {
    return new URL(trimmedPath, manifestUrl).toString();
  }

  const normalizedVersion = version.replace(/^\/+|\/+$/g, "");
  const normalizedPath = trimmedPath.replace(/^\.\/+/, "");
  const versionPrefix = `${normalizedVersion}/`;
  const relativePath = normalizedPath.startsWith(versionPrefix)
    ? normalizedPath
    : `${versionPrefix}${normalizedPath}`;

  return new URL(relativePath, new URL(".", manifestUrl)).toString();
}

function hasArtifactExtension(value: string | undefined, extension: string): value is string {
  return Boolean(
    value?.trim().toLowerCase().split(/[?#]/, 1)[0]?.endsWith(extension.toLowerCase()),
  );
}

function isMsiArtifactPath(value: string | undefined): value is string {
  return hasArtifactExtension(value, ".msi");
}

function getWindowsInstallerFileName(targetKey: AppUpdateTargetKey): string {
  return targetKey === "win_arm_64"
    ? "ladonx_arm64_install.msi"
    : "ladonx_amd64_install.msi";
}

function resolveWindowsInstallerArtifact(
  artifact: UpdateManifestArtifact | undefined,
  platform: AppUpdatePlatformInfo,
): {
  path: string;
  sha256?: string;
  size?: number;
} | null {
  if (!artifact) {
    return null;
  }

  const candidates = [
    {
      path: artifact.install,
      sha256: artifact.installSha256,
      size: artifact.installSize,
    },
    {
      path: isMsiArtifactPath(artifact.main) ? artifact.main : undefined,
      sha256: artifact.mainSha256,
      size: artifact.mainSize,
    },
  ];

  const candidate = candidates.find((entry) => entry.path?.trim());
  if (candidate) {
    const candidatePath = candidate.path?.trim();
    if (candidatePath) {
      return {
        path: candidatePath,
        sha256: candidate.sha256,
        size: candidate.size,
      };
    }
  }

  return {
    path: getWindowsInstallerFileName(platform.targetKey),
  };
}

function resolveDownloadAsset(
  manifest: UpdateManifest,
  platform: AppUpdatePlatformInfo,
): ResolvedUpdateAsset | null {
  const artifact =
    platform.targetKey === "mac_amd_64"
      ? manifest.mac_amd_64
      : platform.targetKey === "mac_arm_64"
        ? manifest.mac_arm_64
        : platform.targetKey === "win_amd_64"
          ? manifest.win_amd_64
          : platform.targetKey === "win_arm_64"
            ? manifest.win_arm_64
            : undefined;
  if (platform.os === "windows") {
    const installer = resolveWindowsInstallerArtifact(artifact, platform);
    if (!installer) {
      return null;
    }
    return {
      version: manifest.version,
      downloadUrl: resolveArtifactDownloadUrl(
        UPDATE_MANIFEST_URL,
        manifest.version,
        installer.path,
      ),
      fileName:
        installer.path.split("/").filter(Boolean).pop() ??
        getWindowsInstallerFileName(platform.targetKey),
      targetKey: platform.targetKey,
      expectedSha256: installer.sha256,
      expectedSize: installer.size,
    };
  }

  const preferredPath = artifact?.install ?? artifact?.main;
  if (!preferredPath) {
    return null;
  }
  const prefersMain = !artifact?.install && Boolean(artifact?.main);
  return {
    version: manifest.version,
    downloadUrl: resolveArtifactDownloadUrl(
      UPDATE_MANIFEST_URL,
      manifest.version,
      preferredPath,
    ),
    fileName: preferredPath.split("/").filter(Boolean).pop() ?? "ladonx-update.bin",
    targetKey: platform.targetKey,
    expectedSha256: prefersMain
      ? artifact?.mainSha256
      : artifact?.installSha256 ?? artifact?.mainSha256,
    expectedSize: prefersMain
      ? artifact?.mainSize
      : artifact?.installSize ?? artifact?.mainSize,
  };
}

function mapDownloadStatusToState(status: AppUpdateDownloadStatus): UpdateState {
  if (status.state === "downloading") {
    return {
      stage: "downloading",
      version: status.version ?? undefined,
      progress: {
        downloadedBytes: status.downloadedBytes,
        totalBytes: status.totalBytes ?? undefined,
      },
      downloadPath: status.path ?? undefined,
    };
  }

  if (status.state === "downloaded") {
    return {
      stage: "downloaded",
      version: status.version ?? undefined,
      progress: {
        downloadedBytes: status.downloadedBytes,
        totalBytes: status.totalBytes ?? undefined,
      },
      downloadPath: status.path ?? undefined,
    };
  }

  if (status.state === "error") {
    return {
      stage: "error",
      version: status.version ?? undefined,
      error: status.error ?? "Unable to download update.",
      progress:
        status.downloadedBytes > 0 || status.totalBytes
          ? {
              downloadedBytes: status.downloadedBytes,
              totalBytes: status.totalBytes ?? undefined,
            }
          : undefined,
      downloadPath: status.path ?? undefined,
    };
  }

  return { stage: "idle" };
}

export function useUpdater({
  enabled = true,
  onDebug,
}: UseUpdaterOptions) {
  const [buildType, setBuildType] = useState<AppBuildType | "unknown">("unknown");
  const [state, setState] = useState<UpdateState>({ stage: "idle" });
  const manifestRef = useRef<UpdateManifest | null>(null);
  const assetRef = useRef<ResolvedUpdateAsset | null>(null);
  const platformRef = useRef<AppUpdatePlatformInfo | null>(null);
  const installPathRef = useRef<string | null>(null);
  const autoDownloadingVersionRef = useRef<string | null>(null);
  const updatesEnabled = enabled && buildType === "release";

  useEffect(() => {
    let active = true;

    void getAppBuildType()
      .then((value) => {
        if (!active) {
          return;
        }
        setBuildType(value);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setBuildType("unknown");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (buildType !== "debug") {
      return;
    }
    manifestRef.current = null;
    assetRef.current = null;
    platformRef.current = null;
    installPathRef.current = null;
    autoDownloadingVersionRef.current = null;
    setState({ stage: "idle" });
  }, [buildType]);

  const beginDownload = useCallback(
    async (asset: ResolvedUpdateAsset) => {
      const nextStatus = await downloadAppUpdate({
        version: asset.version,
        downloadUrl: asset.downloadUrl,
        fileName: asset.fileName,
        expectedSha256: asset.expectedSha256,
        expectedSize: asset.expectedSize,
      });
      setState(mapDownloadStatusToState(nextStatus));
      onDebug?.(
        buildDebugEntry("update/download started", {
          version: asset.version,
          targetKey: asset.targetKey,
          downloadUrl: asset.downloadUrl,
          fileName: asset.fileName,
        }),
      );
    },
    [onDebug],
  );

  const beginInstall = useCallback(async () => {
    const path = installPathRef.current;
    if (!path) {
      setState((current) => ({
        ...current,
        stage: "error",
        error: "Downloaded update package is unavailable.",
      }));
      return;
    }

    setState((current) => ({
      ...current,
      stage: "installing",
    }));

    try {
      await installAndRestartAppUpdate(path);
      setState((current) => ({
        ...current,
        stage: "restarting",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        stage: "error",
        error: getErrorMessage(error, "Unable to restart and install update."),
      }));
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!updatesEnabled) {
      return;
    }

    setState({ stage: "checking", version: __APP_VERSION__ });

    try {
      const { body } = await fetchAppUpdateManifest(UPDATE_MANIFEST_URL);
      const manifest = JSON.parse(body) as Partial<UpdateManifest>;
      const remoteVersion =
        typeof manifest.version === "string" ? normalizeVersion(manifest.version) : "";

      if (!remoteVersion) {
        throw new Error("Update manifest is missing a valid version field.");
      }

      manifestRef.current = manifest as UpdateManifest;
      platformRef.current ??= await getAppUpdatePlatformInfo();
      const asset = resolveDownloadAsset(manifest as UpdateManifest, platformRef.current);
      assetRef.current = asset;
      onDebug?.(
        buildDebugEntry("update/check completed", {
          currentVersion: __APP_VERSION__,
          remoteVersion,
          manifestUrl: UPDATE_MANIFEST_URL,
          platform: platformRef.current,
          downloadAsset: asset,
        }),
      );

      if (normalizeVersion(__APP_VERSION__) !== remoteVersion) {
        if (!asset) {
          setState({
            stage: "error",
            version: remoteVersion,
            error: "No installer is available for this platform.",
          });
          return;
        }
        setState((current) => {
          if (
            current.stage === "downloading" &&
            current.version === remoteVersion
          ) {
            return current;
          }

          return { stage: "available", version: remoteVersion };
        });
        if (autoDownloadingVersionRef.current !== remoteVersion) {
          autoDownloadingVersionRef.current = remoteVersion;
          void beginDownload(asset).catch((error) => {
            autoDownloadingVersionRef.current = null;
            const message = getErrorMessage(error, "Unable to download update.");
            onDebug?.(buildDebugEntry("update/download failed", { error: message }));
            setState({
              stage: "error",
              version: remoteVersion,
              error: message,
            });
          });
        }
        return;
      }

      autoDownloadingVersionRef.current = null;
      installPathRef.current = null;
      setState({ stage: "latest", version: remoteVersion });
    } catch (error) {
      const message = getErrorMessage(error, "Unable to check for updates.");
      onDebug?.(buildDebugEntry("update/check failed", { error: message }));
      setState({
        stage: "error",
        version: __APP_VERSION__,
        error: message,
      });
    }
  }, [beginDownload, onDebug, updatesEnabled]);

  const startUpdate = useCallback(async () => {
    if (!updatesEnabled) {
      return;
    }

    if (state.stage === "downloaded") {
      await beginInstall();
      return;
    }

    const manifest = manifestRef.current;
    let asset = assetRef.current;
    if (!manifest) {
      await checkForUpdates();
      asset = assetRef.current;
    }

    if (!manifest || !asset) {
      const message = "No installer is available for this platform.";
      onDebug?.(
        buildDebugEntry("update/download unavailable", {
          manifestUrl: UPDATE_MANIFEST_URL,
          platform: platformRef.current,
        }),
      );
      setState({
        stage: "error",
        version: manifest?.version,
        error: message,
      });
      return;
    }

    await beginDownload(asset);
  }, [beginDownload, beginInstall, checkForUpdates, state.stage, updatesEnabled]);

  const dismiss = useCallback(() => {
    if (state.stage === "downloading") {
      void cancelAppUpdateDownload().then((status) => {
        setState(mapDownloadStatusToState(status));
      });
      return;
    }
    setState({ stage: "idle" });
  }, [state.stage]);
  const dismissPostUpdateNotice = useCallback(() => {}, []);

  useEffect(() => {
    if (!updatesEnabled) {
      return;
    }

    void checkForUpdates();

    const timer = window.setInterval(() => {
      void checkForUpdates();
    }, UPDATE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [checkForUpdates, updatesEnabled]);

  useEffect(() => {
    if (!updatesEnabled) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const status = await getAppUpdateDownloadStatus();
        if (!active || status.state === "idle") {
          return;
        }
        setState(mapDownloadStatusToState(status));
      } catch {
        // Ignore startup update status errors.
      }
    })();

    const unlisten = subscribeAppUpdateDownload((status) => {
      if (!active) {
        return;
      }
      setState(mapDownloadStatusToState(status));
    });

    return () => {
      active = false;
      unlisten();
    };
  }, [updatesEnabled]);

  useEffect(() => {
    if (state.stage !== "downloaded" || !state.downloadPath) {
      return;
    }
    installPathRef.current = state.downloadPath;
    autoDownloadingVersionRef.current = null;
  }, [state.downloadPath, state.stage]);

  return {
    state,
    startUpdate,
    checkForUpdates,
    dismiss,
    postUpdateNotice: null as PostUpdateNoticeState,
    dismissPostUpdateNotice,
  };
}
