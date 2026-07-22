import { useCallback } from "react";
import type { MouseEvent } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as Sentry from "@sentry/react";
import { openWorkspaceIn } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { OpenAppTarget } from "../../../types";
import {
  type ParsedFileLocation,
  formatFileLocation,
  toFileUrl,
} from "../../../utils/fileLinks";
import {
  isAbsolutePath,
  joinWorkspacePath,
  revealInFileManagerLabel,
} from "../../../utils/platformPaths";
import { useI18nSafe } from "../../../hooks/useI18nSafe";
import { resolveMountedWorkspacePath } from "../utils/mountedWorkspacePaths";

type OpenTarget = {
  id: string;
  label: string;
  appName?: string | null;
  kind: OpenAppTarget["kind"];
  command?: string | null;
  args: string[];
};

const DEFAULT_OPEN_TARGET: OpenTarget = {
  id: "vscode",
  label: "VS Code",
  appName: "Visual Studio Code",
  kind: "app",
  command: null,
  args: [],
};

const resolveAppName = (target: OpenTarget) => (target.appName ?? "").trim();
const resolveCommand = (target: OpenTarget) => (target.command ?? "").trim();

const canOpenTarget = (target: OpenTarget) => {
  if (target.kind === "finder") {
    return true;
  }
  if (target.kind === "command") {
    return Boolean(resolveCommand(target));
  }
  return Boolean(resolveAppName(target));
};

function resolveOpenTarget(
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
): OpenTarget {
  return {
    ...DEFAULT_OPEN_TARGET,
    ...(openTargets.find((entry) => entry.id === selectedOpenAppId) ??
      openTargets[0]),
  };
}

function expandHomePath(path: string, homePath: string | null) {
  const trimmed = path.trim();
  if (!homePath || !trimmed.includes("~")) {
    return trimmed;
  }
  const normalizedHome = homePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = trimmed.replace(/\\/g, "/");
  if (normalizedPath === "~") {
    return normalizedHome;
  }
  const tildeIndex = normalizedPath.indexOf("~/");
  if (tildeIndex < 0) {
    return trimmed;
  }
  const suffix = normalizedPath.slice(tildeIndex + 2).replace(/^\/+/, "");
  return suffix ? `${normalizedHome}/${suffix}` : normalizedHome;
}

async function resolveFilePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  const homePath = await homeDir().catch(() => null);
  const homeExpandedPath = expandHomePath(trimmed, homePath);
  if (!workspacePath) {
    return homeExpandedPath;
  }
  const mountedWorkspacePath = resolveMountedWorkspacePath(homeExpandedPath, workspacePath);
  if (mountedWorkspacePath) {
    return mountedWorkspacePath;
  }
  if (isAbsolutePath(homeExpandedPath)) {
    return homeExpandedPath;
  }
  return joinWorkspacePath(workspacePath, homeExpandedPath);
}

async function resolveFileLinkContext(
  fileLocation: ParsedFileLocation,
  workspacePath?: string | null,
) {
  return {
    fileLocation,
    rawPathLabel: formatFileLocation(
      fileLocation.path,
      fileLocation.line,
      fileLocation.column,
    ),
    resolvedPath: await resolveFilePath(fileLocation.path, workspacePath),
  };
}

export function useFileLinkOpener(
  workspacePath: string | null,
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
  onCollapseSidebar?: () => void,
) {
  const { t } = useI18nSafe();
  const reportOpenError = useCallback(
    (error: unknown, context: Record<string, string | null>) => {
      const message = error instanceof Error ? error.message : String(error);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          tags: {
            feature: "file-link-open",
          },
          extra: context,
        },
      );
      pushErrorToast({
        title: "Couldn’t open file",
        message,
      });
      console.warn("Failed to open file link", { message, ...context });
    },
    [],
  );

  const openFileLink = useCallback(
    async (targetLocation: ParsedFileLocation) => {
      const target = resolveOpenTarget(openTargets, selectedOpenAppId);
      const { fileLocation, rawPathLabel, resolvedPath } = await resolveFileLinkContext(
        targetLocation,
        workspacePath,
      );
      const openLocation = {
        ...(fileLocation.line !== null ? { line: fileLocation.line } : {}),
        ...(fileLocation.column !== null ? { column: fileLocation.column } : {}),
      };

      try {
        if (!canOpenTarget(target)) {
          return;
        }
        if (target.kind === "finder") {
          await revealItemInDir(resolvedPath);
          onCollapseSidebar?.();
          return;
        }

        if (target.kind === "command") {
          const command = resolveCommand(target);
          if (!command) {
            return;
          }
          await openWorkspaceIn(resolvedPath, {
            command,
            args: target.args,
            ...openLocation,
          });
          onCollapseSidebar?.();
          return;
        }

        const appName = resolveAppName(target);
        if (!appName) {
          return;
        }
        await openWorkspaceIn(resolvedPath, {
          appName,
          args: target.args,
          ...openLocation,
        });
        onCollapseSidebar?.();
      } catch (error) {
        reportOpenError(error, {
          rawPath: rawPathLabel,
          resolvedPath,
          workspacePath,
          targetId: target.id,
          targetKind: target.kind,
          targetAppName: target.appName ?? null,
          targetCommand: target.command ?? null,
        });
      }
    },
    [openTargets, reportOpenError, selectedOpenAppId, workspacePath, onCollapseSidebar],
  );

  const showFileLinkMenu = useCallback(
    async (event: MouseEvent, targetLocation: ParsedFileLocation) => {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveOpenTarget(openTargets, selectedOpenAppId);
      const { fileLocation, rawPathLabel, resolvedPath } = await resolveFileLinkContext(
        targetLocation,
        workspacePath,
      );
      const appName = resolveAppName(target);
      const command = resolveCommand(target);
      const canOpen = canOpenTarget(target);
      const openLabel =
        target.kind === "finder"
          ? revealInFileManagerLabel()
          : target.kind === "command"
            ? command
              ? String(t("messages.fileLinks.openInTarget", { target: target.label }))
              : String(t("messages.fileLinks.setCommandInSettings"))
            : appName
              ? String(t("messages.fileLinks.openInTarget", { target: appName }))
              : String(t("messages.fileLinks.setAppNameInSettings"));
      const items = [
        await MenuItem.new({
          text: openLabel,
          enabled: canOpen,
          action: async () => {
            await openFileLink(fileLocation);
          },
        }),
        ...(target.kind === "finder"
          ? []
          : [
              await MenuItem.new({
                text: revealInFileManagerLabel(),
                action: async () => {
                  try {
                    await revealItemInDir(resolvedPath);
                  } catch (error) {
                    reportOpenError(error, {
                      rawPath: rawPathLabel,
                      resolvedPath,
                      workspacePath,
                      targetId: target.id,
                      targetKind: "finder",
                      targetAppName: null,
                      targetCommand: null,
                    });
                  }
                },
              }),
            ]),
        await MenuItem.new({
          text: String(t("messages.fileLinks.downloadLinkedFile")),
          enabled: false,
        }),
        await MenuItem.new({
          text: String(t("messages.fileLinks.copyLink")),
          action: async () => {
            const link = toFileUrl(resolvedPath, fileLocation.line, fileLocation.column);
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Services" }),
      ];

      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [openFileLink, openTargets, reportOpenError, selectedOpenAppId, t, workspacePath],
  );

  return { openFileLink, showFileLinkMenu };
}
