import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Bell from "lucide-react/dist/esm/icons/bell";
import Circle from "lucide-react/dist/esm/icons/circle";
import FileSearch from "lucide-react/dist/esm/icons/file-search";
import History from "lucide-react/dist/esm/icons/history";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Play from "lucide-react/dist/esm/icons/play";
import SquareChevronRight from "lucide-react/dist/esm/icons/square-chevron-right";
import { listAutomations } from "@services/tauri";
import type { AutomationItem } from "@/types";

export function AutomationView() {
  const { t } = useTranslation();
  const [automationItems, setAutomationItems] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadAutomations() {
      setLoading(true);
      setError(null);
      try {
        const items = await listAutomations();
        if (!canceled) {
          setAutomationItems(items);
        }
      } catch (loadError) {
        if (!canceled) {
          setAutomationItems([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void loadAutomations();

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <section className="automation-view" aria-label={t("automation.title")}>
      <header className="automation-header">
        <h1 className="automation-title">{t("automation.title")}</h1>
        <p className="automation-subtitle">
          {t("automation.subtitle")}
          <button type="button">{t("automation.learnMore")}</button>
        </p>
        <div className="automation-header-actions">
          <button className="automation-template-button" type="button">
            {t("automation.viewTemplates")}
          </button>
          {/* <button className="automation-create-button" type="button">
            <span>{t("automation.createViaChat")}</span>
            <span className="automation-create-chevron" aria-hidden>
              ▾
            </span>
          </button> */}
        </div>
      </header>

      <div className="automation-content">
        {loading ? (
          <div className="automation-empty-state" role="status">
            {t("automation.loading")}
          </div>
        ) : error ? (
          <div className="automation-empty-state" role="alert">
            {t("automation.loadError", { error })}
          </div>
        ) : automationItems.length === 0 ? (
          <div className="automation-empty-state">
            <SquareChevronRight size={88} strokeWidth={1.3} aria-hidden />
            <h2>{t("automation.createFirst")}</h2>
            <div className="automation-template-list" aria-label={t("automation.templateListAriaLabel")}>
              <button type="button">
                <Bell size={16} strokeWidth={1.9} aria-hidden />
                <span>{t("automation.templateDailyBriefing")}</span>
              </button>
              <button type="button">
                <History size={16} strokeWidth={1.9} aria-hidden />
                <span>{t("automation.templateWeeklyRecap")}</span>
              </button>
              <button type="button">
                <FileSearch size={16} strokeWidth={1.9} aria-hidden />
                <span>{t("automation.templateProjectMonitor")}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="automation-section-title">{t("automation.sectionCurrent")}</h2>
            <div className="automation-rule-list">
              {automationItems.map((item) => (
                <article className="automation-rule-row" key={item.id}>
                  <div className="automation-rule-main">
                    <Circle size={14} strokeWidth={2} aria-hidden />
                    <div className="automation-rule-copy">
                      <span className="automation-rule-title">{item.title}</span>
                      <span className="automation-rule-owner">{item.owner}</span>
                    </div>
                  </div>
                  <div className="automation-rule-actions" aria-label={t("automation.ruleActionsAriaLabel", { title: item.title })}>
                    <button type="button" aria-label={t("automation.runAriaLabel", { title: item.title })}>
                      <Play size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                    <button type="button" aria-label={t("automation.editAriaLabel", { title: item.title })}>
                      <Pencil size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                    <button type="button" aria-label={t("automation.moreAriaLabel", { title: item.title })}>
                      <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
