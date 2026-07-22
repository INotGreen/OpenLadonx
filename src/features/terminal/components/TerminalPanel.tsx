import type { RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TerminalStatus } from "../../../types";

type TerminalPanelProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  status: TerminalStatus;
  message: string;
};

export function TerminalPanel({ containerRef, status, message }: TerminalPanelProps) {
  const showOverlay = status !== "ready";
  const isError = status === "error";

  return (
    <div className="terminal-shell relative flex min-h-0 flex-1">
      <div
        ref={containerRef}
        className={cn(
          "terminal-surface xterm-host",
          "relative flex-1 min-h-0 h-full overflow-hidden",
          "border-t border-white/[0.08] box-border",
        )}
      />
      <AnimatePresence initial={false}>
        {showOverlay && (
          <motion.div
            key="terminal-overlay"
            className="terminal-overlay pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <Card
              className={cn(
                "max-w-[280px] border-border-subtle bg-card/85 px-3 py-2 text-card-foreground shadow-lg",
                isError && "border-destructive/40",
              )}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full mr-2 align-middle",
                  isError
                    ? "bg-destructive animate-pulse"
                    : "bg-ring/70 animate-pulse",
                )}
              />
              <span className="align-middle text-muted-fg">{message}</span>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
