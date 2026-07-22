import {
  getIconForDirectoryPath,
  getIconUrlByName,
  getIconUrlForFilePath,
  isMaterialIconName,
} from "vscode-material-icons";

const MATERIAL_ICONS_BASE_URL = "/assets/material-icons";
const iconUrlCache = new Map<string, string>();

export function getFileTypeIconUrl(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const cached = iconUrlCache.get(normalizedPath);
  if (cached) {
    return cached;
  }
  const iconUrl = getIconUrlForFilePath(normalizedPath, MATERIAL_ICONS_BASE_URL);
  iconUrlCache.set(normalizedPath, iconUrl);
  return iconUrl;
}

export function getFolderTypeIconUrl(path: string, isExpanded = false): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const cacheKey = `${normalizedPath}::${isExpanded ? "open" : "closed"}`;
  const cached = iconUrlCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const iconName = getIconForDirectoryPath(normalizedPath);
  const expandedIconName = `${iconName}-open`;
  const resolvedIconName =
    isExpanded && isMaterialIconName(expandedIconName) ? expandedIconName : iconName;
  const iconUrl = getIconUrlByName(resolvedIconName, MATERIAL_ICONS_BASE_URL);
  iconUrlCache.set(cacheKey, iconUrl);
  return iconUrl;
}
