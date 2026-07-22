import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type { TerminalTab } from "../../terminal/hooks/useTerminalTabs";

type TerminalDockProps = {
  isOpen: boolean;
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onHideTerminalPanel: () => void;
  terminalNode: ReactNode;
};

export function TerminalDock({
  isOpen,
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onHideTerminalPanel,
  terminalNode,
}: TerminalDockProps) {
  const { t } = useI18nSafe();
  const activeTabId = activeTerminalId ?? terminals[0]?.id ?? null;
  const hasTabs = terminals.length > 0;
  const closeTerminalLabel = t("terminal.closeTerminal");
  const newTerminalLabel = t("terminal.newTerminal");
  const hideTerminalPanelLabel = t("terminal.hideTerminalPanel");

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.section
          key="terminal-dock"
          className="terminal-panel"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        >
          <div className="terminal-header px-3 py-1">
            <div className="terminal-header-row">
              <div className="terminal-tabs-list">
                <AnimatePresence initial={false}>
                  {terminals.map((tab) => {
                    const label = tab.title || tab.cwd || "Terminal";
                    const isActive = tab.id === activeTabId;
                    return (
                      <motion.button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive ? "true" : "false"}
                        onClick={() => onSelectTerminal(tab.id)}
                        initial={{ opacity: 0, y: 1 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 1 }}
                        transition={{ duration: 0.14, ease: "easeOut" }}
                        className={`terminal-tab${isActive ? " terminal-active-tab" : ""}`}
                      >
                        <TerminalSquare size={14} strokeWidth={2} className="terminal-active-tab-icon" />
                        <span className="terminal-active-tab-title">{label}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={closeTerminalLabel}
                          title={closeTerminalLabel}
                          className="terminal-active-tab-close"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCloseTerminal(tab.id);
                          }}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              onCloseTerminal(tab.id);
                            }
                          }}
                        >
                          <X size={12} strokeWidth={2} />
                        </span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={onNewTerminal}
                onMouseDown={(event) => event.preventDefault()}
                aria-label={newTerminalLabel}
                title={newTerminalLabel}
                className="terminal-toolbar-icon"
              >
                <Plus size={16} strokeWidth={2} />
              </Button>

              {hasTabs && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onHideTerminalPanel}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label={hideTerminalPanelLabel}
                  title={hideTerminalPanelLabel}
                  className="terminal-toolbar-icon terminal-toolbar-close"
                >
                  <X size={16} strokeWidth={2} />
                </Button>
              )}
            </div>
          </div>

          <div className="terminal-body">{terminalNode}</div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
