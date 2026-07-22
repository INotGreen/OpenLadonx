import { DebugPanel } from "../../../debug/components/DebugPanel";
import { TerminalDock } from "../../components/TerminalDock";
import { TerminalPanel } from "../../../terminal/components/TerminalPanel";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type {
  LayoutNodesResult,
  LayoutSecondarySurface,
} from "./types";

export type SecondaryLayoutNodesOptions = LayoutSecondarySurface;

type SecondaryLayoutNodes = Pick<
  LayoutNodesResult,
  | "debugPanelNode"
  | "debugPanelFullNode"
  | "terminalNode"
  | "compactEmptyChatNode"
  | "compactEmptyGitNode"
  | "compactGitBackNode"
>;

function buildTerminalPanelNode(terminalState: SecondaryLayoutNodesOptions["terminalState"]) {
  if (!terminalState) {
    return null;
  }

  return (
    <TerminalPanel
      containerRef={terminalState.containerRef}
      status={terminalState.status}
      message={terminalState.message}
    />
  );
}

function buildDebugPanels(debugPanelProps: SecondaryLayoutNodesOptions["debugPanelProps"]) {
  const debugPanelNode = <DebugPanel {...debugPanelProps} />;
  const debugPanelFullNode = (
    <DebugPanel
      {...debugPanelProps}
      isOpen
      variant="full"
    />
  );

  return { debugPanelNode, debugPanelFullNode };
}

function buildCompactEmptyNode({
  title,
  description,
  onGoProjects,
  goToProjectsLabel,
}: {
  title: string;
  description: string;
  onGoProjects: () => void;
  goToProjectsLabel: string;
}) {
  return (
    <div className="compact-empty">
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="ghost" onClick={onGoProjects}>
        {goToProjectsLabel}
      </button>
    </div>
  );
}

function buildCompactGitBackNode(
  compactNavProps: SecondaryLayoutNodesOptions["compactNavProps"],
  labels: { files: string; diff: string },
) {
  const compactGitDiffActive =
    compactNavProps.centerMode === "diff" &&
    Boolean(compactNavProps.selectedDiffPath);

  return (
    <div className="compact-git-back">
      <button
        type="button"
        className={`compact-git-switch-button${compactGitDiffActive ? "" : " active"}`}
        onClick={compactNavProps.onBackFromDiff}
      >
        {labels.files}
      </button>
      <button
        type="button"
        className={`compact-git-switch-button${compactGitDiffActive ? " active" : ""}`}
        onClick={compactNavProps.onShowSelectedDiff}
        disabled={!compactNavProps.hasActiveGitDiffs}
      >
        {labels.diff}
      </button>
    </div>
  );
}

export function buildSecondaryNodes(options: SecondaryLayoutNodesOptions): SecondaryLayoutNodes {
  const { t } = useI18nSafe();
  const terminalNode = (
    <TerminalDock {...options.terminalDockProps} terminalNode={buildTerminalPanelNode(options.terminalState)} />
  );

  const { debugPanelNode, debugPanelFullNode } = buildDebugPanels(options.debugPanelProps);

  const goToProjectsLabel = String(t("layout.goToProjects"));
  const compactEmptyChatNode = buildCompactEmptyNode({
    title: String(t("layout.noWorkspaceSelected")),
    description: String(t("layout.chooseProjectToChat")),
    onGoProjects: options.compactNavProps.onGoProjects,
    goToProjectsLabel,
  });

  const compactEmptyGitNode = buildCompactEmptyNode({
    title: String(t("layout.noWorkspaceSelected")),
    description: String(t("layout.chooseProjectToInspectDiffs")),
    onGoProjects: options.compactNavProps.onGoProjects,
    goToProjectsLabel,
  });

  const compactGitBackNode = buildCompactGitBackNode(options.compactNavProps, {
    files: String(t("file.files")),
    diff: String(t("git.diff")),
  });

  return {
    debugPanelNode,
    debugPanelFullNode,
    terminalNode,
    compactEmptyChatNode,
    compactEmptyGitNode,
    compactGitBackNode,
  };
}
