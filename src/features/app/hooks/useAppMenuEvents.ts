// 应用菜单事件处理Hook
// 用于监听和处理应用程序菜单的各种操作事件
import type { MutableRefObject } from "react";
import { useTauriEvent } from "./useTauriEvent";
import {
  subscribeMenuAddWorkspace,
  subscribeMenuAddWorkspaceFromUrl,
  subscribeMenuNewAgent,
  subscribeMenuNewCloneAgent,
  subscribeMenuNewWorktreeAgent,
  subscribeMenuOpenSettings,
  subscribeMenuPrevAgent,
  subscribeMenuNextAgent,
  subscribeMenuPrevWorkspace,
  subscribeMenuNextWorkspace,
  subscribeMenuToggleDebugPanel,
  subscribeMenuToggleGitSidebar,
  subscribeMenuToggleProjectsSidebar,
  subscribeMenuToggleTerminal,
} from "../../../services/events";
import type { WorkspaceInfo } from "../../../types";

// 参数类型定义
type Params = {
  activeWorkspaceRef: MutableRefObject<WorkspaceInfo | null>; // 当前活动工作空间的引用
  baseWorkspaceRef: MutableRefObject<WorkspaceInfo | null>; // 基础工作空间的引用
  onAddWorkspace: () => void; // 添加工作空间的回调
  onAddWorkspaceFromUrl: () => void; // 从URL添加工作空间的回调
  onAddAgent: (workspace: WorkspaceInfo) => void; // 添加代理的回调
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void; // 添加工作树代理的回调
  onAddCloneAgent: (workspace: WorkspaceInfo) => void; // 添加克隆代理的回调
  onOpenSettings: () => void; // 打开设置的回调
  onCycleAgent: (direction: "next" | "prev") => void; // 切换代理的回调
  onCycleWorkspace: (direction: "next" | "prev") => void; // 切换工作空间的回调
  onToggleDebug: () => void; // 切换调试面板的回调
  onToggleTerminal: () => void; // 切换终端的回调
  sidebarCollapsed: boolean; // 侧边栏是否折叠
  rightPanelCollapsed: boolean; // 右侧面板是否折叠
  onExpandSidebar: () => void; // 展开侧边栏的回调
  onCollapseSidebar: () => void; // 折叠侧边栏的回调
  onExpandRightPanel: () => void; // 展开右侧面板的回调
  onCollapseRightPanel: () => void; // 折叠右侧面板的回调
};

export function useAppMenuEvents({
  activeWorkspaceRef,
  baseWorkspaceRef,
  onAddWorkspace,
  onAddWorkspaceFromUrl,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onOpenSettings,
  onCycleAgent,
  onCycleWorkspace,
  onToggleDebug,
  onToggleTerminal,
  sidebarCollapsed,
  rightPanelCollapsed,
  onExpandSidebar,
  onCollapseSidebar,
  onExpandRightPanel,
  onCollapseRightPanel,
}: Params) {
  // 监听新代理菜单事件，在当前活动工作空间中创建新代理
  useTauriEvent(subscribeMenuNewAgent, () => {
    const workspace = activeWorkspaceRef.current;
    if (workspace) {
      onAddAgent(workspace);
    }
  });

  // 监听新工作树代理菜单事件，在基础工作空间中创建新工作树代理
  useTauriEvent(subscribeMenuNewWorktreeAgent, () => {
    const workspace = baseWorkspaceRef.current;
    if (workspace) {
      onAddWorktreeAgent(workspace);
    }
  });

  // 监听新克隆代理菜单事件，在基础工作空间中创建新克隆代理
  useTauriEvent(subscribeMenuNewCloneAgent, () => {
    const workspace = baseWorkspaceRef.current;
    if (workspace) {
      onAddCloneAgent(workspace);
    }
  });

  // 监听添加工作空间菜单事件
  useTauriEvent(subscribeMenuAddWorkspace, () => {
    onAddWorkspace();
  });

  // 监听从URL添加工作空间菜单事件
  useTauriEvent(subscribeMenuAddWorkspaceFromUrl, () => {
    onAddWorkspaceFromUrl();
  });

  // 监听打开设置菜单事件
  useTauriEvent(subscribeMenuOpenSettings, () => {
    onOpenSettings();
  });

  // 监听下一个代理菜单事件
  useTauriEvent(subscribeMenuNextAgent, () => {
    onCycleAgent("next");
  });

  // 监听上一个代理菜单事件
  useTauriEvent(subscribeMenuPrevAgent, () => {
    onCycleAgent("prev");
  });

  // 监听下一个工作空间菜单事件
  useTauriEvent(subscribeMenuNextWorkspace, () => {
    onCycleWorkspace("next");
  });

  // 监听上一个工作空间菜单事件
  useTauriEvent(subscribeMenuPrevWorkspace, () => {
    onCycleWorkspace("prev");
  });

  // 监听切换调试面板菜单事件
  useTauriEvent(subscribeMenuToggleDebugPanel, () => {
    onToggleDebug();
  });

  // 监听切换终端菜单事件
  useTauriEvent(subscribeMenuToggleTerminal, () => {
    onToggleTerminal();
  });

  // 监听切换项目侧边栏菜单事件，根据当前状态展开或折叠侧边栏
  useTauriEvent(subscribeMenuToggleProjectsSidebar, () => {
    if (sidebarCollapsed) {
      onExpandSidebar();
    } else {
      onCollapseSidebar();
    }
  });

  // 监听切换Git侧边栏菜单事件，根据当前状态展开或折叠右侧面板
  useTauriEvent(subscribeMenuToggleGitSidebar, () => {
    if (rightPanelCollapsed) {
      onExpandRightPanel();
    } else {
      onCollapseRightPanel();
    }
  });
}
