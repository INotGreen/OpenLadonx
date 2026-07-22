import { useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import type { PluginMarketItem, SkillOption } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { PluginsView } from "@app/components/PluginsView";
import { SkillsView } from "@app/components/SkillsView";

type SkillsStoreViewProps = {
  skills: SkillOption[];
  plugins: PluginMarketItem[];
  pluginsLoading?: boolean;
  onRefreshPlugins: () => void;
  onRefresh: () => void;
  onUseSkill?: (skill: SkillOption) => void;
};

type StoreTab = "plugins" | "skills";

export function SkillsStoreView({
  skills,
  plugins,
  pluginsLoading,
  onRefreshPlugins,
  onRefresh,
  onUseSkill,
}: SkillsStoreViewProps) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  const [activeTab, setActiveTab] = useState<StoreTab>("plugins");
  const [pluginQuery, setPluginQuery] = useState("");
  const [skillQuery, setSkillQuery] = useState("");

  return (
    <section className="skills-store" aria-label={t("skillsStore.ariaLabel")}>
      <header className="skills-store-header">
        <div className="skills-store-primary-controls">
          <div className="skills-store-tabs" role="tablist" aria-label={t("skillsStore.tabsAriaLabel")}>
            <button type="button" role="tab" aria-selected={activeTab === "plugins"} className={`skills-store-tab${activeTab === "plugins" ? " is-active" : ""}`} onClick={() => setActiveTab("plugins")}>
              {t("skillsStore.pluginsTab")}
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "skills"} className={`skills-store-tab${activeTab === "skills" ? " is-active" : ""}`} onClick={() => setActiveTab("skills")}>
              {t("skillsStore.skillsTab")}
            </button>
          </div>
          <button
            className="skills-store-refresh"
            type="button"
            onClick={activeTab === "plugins" ? onRefreshPlugins : onRefresh}
          >
            <RefreshCw size={16} aria-hidden />
            <span>{t("skillsStore.refresh")}</span>
          </button>
        </div>
        <div className="skills-store-toolbar">
          <label className="skills-store-search">
            <Search size={17} aria-hidden />
            <input
              value={activeTab === "plugins" ? pluginQuery : skillQuery}
              onChange={(event) =>
                activeTab === "plugins" ? setPluginQuery(event.target.value) : setSkillQuery(event.target.value)
              }
              placeholder={activeTab === "plugins" ? t("skillsStore.searchPluginsPlaceholder") : t("skillsStore.searchSkillsPlaceholder")}
            />
          </label>
          {activeTab === "skills" ? (
            <button className="skills-store-new-button" type="button">
              <Plus size={20} aria-hidden />
              <span>{t("skillsStore.newSkill")}</span>
            </button>
          ) : null}
        </div>
      </header>

      {activeTab === "plugins" ? (
        <PluginsView
          plugins={plugins}
          isLoading={pluginsLoading}
          query={pluginQuery}
          onPluginsChanged={onRefreshPlugins}
        />
      ) : (
        <SkillsView
          skills={skills}
          onUseSkill={onUseSkill}
          query={skillQuery}
        />
      )}
    </section>
  );
}
