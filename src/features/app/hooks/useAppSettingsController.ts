// 应用设置控制器Hook
// 集中管理应用的各种设置和偏好
import { useThemePreference } from "../../layout/hooks/useThemePreference";
import { useTransparencyPreference } from "../../layout/hooks/useTransparencyPreference";
import { useUiScaleShortcuts } from "../../layout/hooks/useUiScaleShortcuts";
import { useAppSettings } from "../../settings/hooks/useAppSettings";
import { runCodexUpdate } from "../../../services/tauri";

export function useAppSettingsController() {
  // 获取应用设置的状态管理
  const {
    settings: appSettings,
    setSettings: setAppSettings,
    saveSettings,
    doctor,
    isLoading: appSettingsLoading,
  } = useAppSettings();

  // 应用主题偏好设置
  useThemePreference(appSettings.theme);

  // 透明度偏好设置
  const { reduceTransparency, setReduceTransparency } =
    useTransparencyPreference();

  // UI缩放快捷键设置
  const {
    uiScale,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
  } = useUiScaleShortcuts({
    settings: appSettings,
    setSettings: setAppSettings,
    saveSettings,
  });

  // 返回所有设置控制相关的状态和函数
  return {
    appSettings, // 应用设置对象
    setAppSettings, // 设置应用设置的函数
    saveSettings, // 保存设置的函数
    queueSaveSettings, // 队列保存设置的函数
    doctor, // 诊断检查函数
    codexUpdate: (codexBin: string | null, codexArgs: string | null) =>
      runCodexUpdate(codexBin, codexArgs), // Codex更新函数
    appSettingsLoading, // 设置加载状态
    reduceTransparency, // 减少透明度设置
    setReduceTransparency, // 设置透明度减少的函数
    uiScale, // UI缩放比例
    scaleShortcutTitle, // 缩放快捷键标题
    scaleShortcutText, // 缩放快捷键文本
  };
}
