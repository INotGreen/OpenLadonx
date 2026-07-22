import type {
  WorkspaceHomeRun,
  WorkspaceHomeRunInstance,
} from "../hooks/useWorkspaceHome";
import type { ThreadStatusById } from "../../../utils/threadStatus";

type WorkspaceHomeHistoryProps = {
  runs: WorkspaceHomeRun[];
  recentThreadInstances: WorkspaceHomeRunInstance[];
  recentThreadsUpdatedAt: number | null;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  onSelectInstance: (workspaceId: string, threadId: string) => void;
};

export function WorkspaceHomeHistory({
  runs: _runs,
  recentThreadInstances: _recentThreadInstances,
  recentThreadsUpdatedAt: _recentThreadsUpdatedAt,
  activeWorkspaceId: _activeWorkspaceId,
  activeThreadId: _activeThreadId,
  threadStatusById: _threadStatusById,
  onSelectInstance: _onSelectInstance,
}: WorkspaceHomeHistoryProps) {
  return null;
}
