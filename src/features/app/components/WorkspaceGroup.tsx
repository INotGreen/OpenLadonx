type WorkspaceGroupProps = {
  toggleId: string | null;
  name: string;
  icon?: React.ReactNode;
  labelClassName?: string;
  showHeader: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (groupId: string) => void;
  headerClassName?: string;
  hideToggle?: boolean;
  children: React.ReactNode;
};

export function WorkspaceGroup({
  toggleId,
  name,
  icon,
  labelClassName,
  showHeader,
  isCollapsed,
  onToggleCollapse,
  headerClassName,
  hideToggle = false,
  children,
}: WorkspaceGroupProps) {
  const isToggleable = Boolean(toggleId) && !hideToggle;
  return (
    <div className="workspace-group">
      {showHeader && (
        <div
          className={`workspace-group-header${headerClassName ? ` ${headerClassName}` : ""}${
            isToggleable ? " is-toggleable" : ""
          }`}
          onClick={
            isToggleable
              ? () => {
                  if (!toggleId) {
                    return;
                  }
                  onToggleCollapse(toggleId);
                }
              : undefined
          }
          onKeyDown={
            isToggleable
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!toggleId) {
                      return;
                    }
                    onToggleCollapse(toggleId);
                  }
                }
              : undefined
          }
          role={isToggleable ? "button" : undefined}
          aria-label={isToggleable ? `${isCollapsed ? "Expand" : "Collapse"} group` : undefined}
          aria-expanded={isToggleable ? !isCollapsed : undefined}
          tabIndex={isToggleable ? 0 : undefined}
        >
          {icon ? <span className="workspace-group-icon" aria-hidden>{icon}</span> : null}
          <div className={`workspace-group-label${labelClassName ? ` ${labelClassName}` : ""}`}>
            {name}
          </div>
          {isToggleable && (
            <button
              className={`group-toggle ${isCollapsed ? "" : "expanded"}`}
              onClick={(event) => {
                event.stopPropagation();
                if (!toggleId) {
                  return;
                }
                onToggleCollapse(toggleId);
              }}
              aria-label={isCollapsed ? "Expand group" : "Collapse group"}
              aria-expanded={!isCollapsed}
              type="button"
            >
              <span className="group-toggle-icon">›</span>
            </button>
          )}
        </div>
      )}
      <div className={`workspace-group-list ${isCollapsed ? "collapsed" : ""}`}>
        <div className="workspace-group-content">{children}</div>
      </div>
    </div>
  );
}
