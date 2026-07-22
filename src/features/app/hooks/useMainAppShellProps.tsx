import type { ComponentProps } from "react";
import { MainAppShell } from "@app/components/MainAppShell";

type UseMainAppShellPropsArgs = {
  shell: Pick<
    ComponentProps<typeof MainAppShell>,
    | "appClassName"
    | "isResizing"
    | "appStyle"
    | "appRef"
    | "sidebarToggleProps"
    | "shouldLoadGitHubPanelData"
    | "appModalsProps"
    | "showMobileSetupWizard"
    | "mobileSetupWizardProps"
  >;
  gitHubPanelDataProps: ComponentProps<typeof MainAppShell>["gitHubPanelDataProps"];
  appLayout: ComponentProps<typeof MainAppShell>["appLayoutProps"];
};

export function useMainAppShellProps({
  shell,
  gitHubPanelDataProps,
  appLayout,
}: UseMainAppShellPropsArgs) {
  return {
    ...shell,
    gitHubPanelDataProps,
    appLayoutProps: appLayout,
  };
}
