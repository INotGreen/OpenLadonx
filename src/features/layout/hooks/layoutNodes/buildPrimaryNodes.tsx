import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import FolderCode from "lucide-react/dist/esm/icons/folder-code";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import { Sidebar } from "../../../app/components/Sidebar";
import { MainHeader } from "../../../app/components/MainHeader";
import { Messages } from "../../../messages/components/Messages";
import {
  ThreadStatusPanel,
  hasThreadStatusPanelContent,
} from "../../../messages/components/ThreadStatusPanel";
import { ApprovalToasts } from "../../../app/components/ApprovalToasts";
import { UpdateToast } from "../../../update/components/UpdateToast";
import { ErrorToasts } from "../../../notifications/components/ErrorToasts";
import { SuccessToasts } from "../../../notifications/components/SuccessToasts";
import { Composer } from "../../../composer/components/Composer";
import { TabBar } from "../../../app/components/TabBar";
import { TabletNav } from "../../../app/components/TabletNav";
import type {
  LayoutNodesResult,
  LayoutPrimarySurface,
} from "./types";

export type PrimaryLayoutNodesOptions = LayoutPrimarySurface;

type PrimaryLayoutNodes = Pick<
  LayoutNodesResult,
  | "sidebarNode"
  | "messagesNode"
  | "threadStatusPanelNode"
  | "composerNode"
  | "approvalToastsNode"
  | "updateToastNode"
  | "errorToastsNode"
  | "successToastsNode"
  | "homeNode"
  | "mainHeaderNode"
  | "desktopTopbarLeftNode"
  | "tabletNavNode"
  | "tabBarNode"
>;

export function buildPrimaryNodes(options: PrimaryLayoutNodesOptions): PrimaryLayoutNodes {
  const sidebarNode = <Sidebar {...options.sidebarProps} />;

  const messagesNode = <Messages {...options.messagesProps} />;
  const threadStatusPanelNode = hasThreadStatusPanelContent(options.threadStatusPanelProps)
    ? <ThreadStatusPanel {...options.threadStatusPanelProps} />
    : null;

  const composerNode = options.composerProps ? <Composer {...options.composerProps} /> : null;

  const approvalToastsNode = <ApprovalToasts {...options.approvalToastsProps} />;

  const updateToastNode = <UpdateToast {...options.updateToastProps} />;

  const errorToastsNode = <ErrorToasts {...options.errorToastsProps} />;
  const successToastsNode = <SuccessToasts {...options.successToastsProps} />;

  const homeNode = null;

  const mainHeaderNode = options.mainHeaderProps ? (
    <MainHeader {...options.mainHeaderProps} />
  ) : null;

  const desktopTopbarLeftNode = (
    <>
      {options.desktopTopbarProps.showBackToChat && (
        <button
          className="icon-button back-button"
          onClick={options.desktopTopbarProps.onExitDiff}
          aria-label="Back to chat"
        >
          <ArrowLeft aria-hidden />
        </button>
      )}
      {options.desktopTopbarProps.workspace && (
        <div
          className={`topbar-workspace-indicator ${
            options.desktopTopbarProps.workspace.source === "claude_code"
              ? "is-claude"
              : "is-codex"
          }`}
          title={options.desktopTopbarProps.workspace.path}
        >
          <span className="topbar-workspace-source">
            {options.desktopTopbarProps.workspace.source === "claude_code" ? (
              <FolderCode aria-hidden />
            ) : (
              <FolderOpen aria-hidden />
            )}
            {/* <span>
              {options.desktopTopbarProps.workspace.source === "claude_code"
                ? "Claude Code"
                : "Codex"}
            </span> */}
          </span>
          <span className="topbar-workspace-path">
            {options.desktopTopbarProps.workspace.path}
          </span>
        </div>
      )}
      {mainHeaderNode}
    </>
  );

  const tabletNavNode = (
    <TabletNav {...options.tabletNavProps} />
  );

  const tabBarNode = <TabBar {...options.tabBarProps} />;

  return {
    sidebarNode,
    messagesNode,
    threadStatusPanelNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    successToastsNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
  };
}
