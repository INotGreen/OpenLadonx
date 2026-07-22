/*
*/

import type { ReactNode } from "react";

import {
  PanelFrame,
  PanelHeader,
} from "../../design-system/components/panel/PanelPrimitives";
import { PanelTabs, type PanelTabId } from "./PanelTabs";

type PanelShellProps = {
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  className?: string;
  headerClassName?: string;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  search?: ReactNode;
  children: ReactNode;
};

export function PanelShell({
  filePanelMode,
  onFilePanelModeChange,
  className,
  headerClassName,
  headerLeft,
  headerRight,
  search,
  children,
}: PanelShellProps) {
  return (
    <PanelFrame className={className}>
      <PanelHeader className={headerClassName}>
        {headerLeft ?? <PanelTabs active={filePanelMode} onSelect={onFilePanelModeChange} />}
        {headerRight}
      </PanelHeader>
      {search}
      {children}
    </PanelFrame>
  );
}
