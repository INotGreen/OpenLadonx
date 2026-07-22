import CircleEllipsis from "lucide-react/dist/esm/icons/circle-ellipsis";
import X from "lucide-react/dist/esm/icons/x";
import { useEffect, useMemo, useState } from "react";
import type { PluginMarketItem } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import { installPlugin, uninstallPlugin } from "@/services/tauri";

type PluginsViewProps = {
  plugins: PluginMarketItem[];
  isLoading?: boolean;
  query?: string;
  onPluginsChanged?: () => void;
};

type StoreItem = {
  id: string;
  name: string;
  description: string;
  iconLabel: string;
  iconClassName: string;
  iconSrc?: string;
  installed: boolean;
  brandColor?: string;
  category?: string;
  longDescription?: string;
};

type PluginCategoryGroup = {
  key: string;
  items: StoreItem[];
};

const CATEGORY_ORDER = [
  "Productivity",
  "Developer Tools",
  "Communication",
  "Data & Analytics",
  "Finance",
  "Business & Operations",
  "Education & Research",
  "Creativity",
  "Security",
  "Travel",
  "Other",
];

const CATEGORY_KEY_MAP: Record<string, string> = {
  "Productivity": "skillsStore.categoryProductivity",
  "Developer Tools": "skillsStore.categoryDeveloperTools",
  "Communication": "skillsStore.categoryCommunication",
  "Data & Analytics": "skillsStore.categoryDataAnalytics",
  "Finance": "skillsStore.categoryFinance",
  "Business & Operations": "skillsStore.categoryBusinessOperations",
  "Education & Research": "skillsStore.categoryEducationResearch",
  "Creativity": "skillsStore.categoryCreativity",
  "Security": "skillsStore.categorySecurity",
  "Travel": "skillsStore.categoryTravel",
  "Other": "skillsStore.categoryOther",
};

function categoryKey(raw: string): string {
  const trimmed = raw.trim();
  const mapped = CATEGORY_KEY_MAP[trimmed];
  if (mapped) {
    return trimmed;
  }
  return trimmed.length ? trimmed : "Other";
}

function categoryLabel(raw: string, t: (key: string, options?: any) => any): string {
  const trimmed = raw.trim();
  const i18nKey = CATEGORY_KEY_MAP[trimmed];
  if (i18nKey) {
    const translated = t(i18nKey);
    if (translated && translated !== i18nKey) {
      return translated;
    }
  }
  return trimmed.length ? trimmed : String(t("skillsStore.categoryOther"));
}

function groupPluginsByCategory(items: StoreItem[]): PluginCategoryGroup[] {
  const buckets = new Map<string, StoreItem[]>();
  for (const item of items) {
    const key = categoryKey(item.category ?? "");
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const orderIndex = (key: string) => {
    const idx = CATEGORY_ORDER.indexOf(key);
    return idx === -1 ? CATEGORY_ORDER.length : idx;
  };
  return Array.from(buckets.entries())
    .map(([key, groupItems]) => ({
      key,
      items: groupItems.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    }))
    .sort((a, b) => {
      const byOrder = orderIndex(a.key) - orderIndex(b.key);
      if (byOrder !== 0) {
        return byOrder;
      }
      return a.key.localeCompare(b.key, undefined, { sensitivity: "base" });
    });
}

function pluginToStoreItem(
  plugin: PluginMarketItem,
  t: (key: string, options?: any) => any,
): StoreItem {
  const description =
    plugin.shortDescription ||
    plugin.description ||
    String(t("skillsStore.availablePlugin"));
  return {
    id: `plugin:${plugin.id}`,
    name: plugin.displayName || plugin.name,
    description,
    iconLabel: (plugin.displayName || plugin.name).slice(0, 2).toUpperCase(),
    iconClassName: "plugins-icon--plugin",
    iconSrc: plugin.iconDataUrl,
    installed: plugin.installed,
    brandColor: plugin.brandColor,
    category: plugin.category,
    longDescription: plugin.longDescription,
  };
}

function StoreItemRow({
  item,
  onOpen,
  onInstall,
}: {
  item: StoreItem;
  onOpen: (item: StoreItem) => void;
  onInstall: (item: StoreItem) => void;
}) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  return (
    <article
      className="plugins-item"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div
        className={`plugins-icon ${item.iconClassName}${item.iconSrc ? " plugins-icon--image" : ""}`}
        style={item.brandColor ? { backgroundColor: item.brandColor } : undefined}
        aria-hidden
      >
        {item.iconSrc ? (
          <img className="plugins-icon-image" src={item.iconSrc} alt="" />
        ) : (
          item.iconLabel
        )}
      </div>
      <div className="plugins-item-copy">
        <div className="plugins-item-title">{item.name}</div>
        <div className="plugins-item-description">{item.description}</div>
      </div>
      <button
        className={`plugins-item-action${item.installed ? " plugins-item-action--installed" : " plugins-item-action--install"}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (item.installed) {
            onOpen(item);
            return;
          }
          onInstall(item);
        }}
        aria-label={item.installed ? t("skillsStore.moreActions") : t("skillsStore.installItem", { name: item.name })}
      >
        {item.installed ? <CircleEllipsis size={18} aria-hidden /> : <span className="plugins-item-action-label">{t("skillsStore.install")}</span>}
      </button>
    </article>
  );
}

function PluginStoreDetail({
  item,
  onClose,
  onInstall,
  onUninstall,
}: {
  item: StoreItem;
  onClose: () => void;
  onInstall: (item: StoreItem) => void;
  onUninstall: (item: StoreItem) => void;
}) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));

  return (
    <ModalShell
      className="plugins-modal"
      cardClassName="plugins-modal-card"
      onBackdropClick={onClose}
      ariaLabel={t("skillsStore.detailAriaLabel", { name: item.name })}
    >
      <div className="plugins-modal-header">
        <div
          className={`plugins-modal-icon ${item.iconClassName}${item.iconSrc ? " plugins-icon--image" : ""}`}
          aria-hidden
        >
          {item.iconSrc ? (
            <img className="plugins-icon-image" src={item.iconSrc} alt="" />
          ) : (
            item.iconLabel
          )}
        </div>
        <button className="plugins-modal-close" type="button" onClick={onClose} aria-label={t("skillsStore.closeDetail")}>
          <X size={24} aria-hidden />
        </button>
      </div>
      <div className="plugins-modal-title-row">
        <div>
          <h2 className="plugins-modal-title">{item.name}</h2>
          <div className="plugins-modal-type">{t("skillsStore.pluginsTab")}</div>
        </div>
        <div className="plugins-modal-status-row">
          <div
            className={`plugins-modal-status${item.installed ? " is-on" : ""}`}
            aria-label={item.installed ? t("skillsStore.itemInstalled", { name: item.name }) : t("skillsStore.notInstalled", { name: item.name })}
          >
            <span className="plugins-modal-status-thumb" />
          </div>
          <button className="plugins-modal-more" type="button" aria-label={t("skillsStore.moreActions")}>
            <CircleEllipsis size={18} aria-hidden />
          </button>
        </div>
      </div>
      <p className="plugins-modal-description">{item.description}</p>
      <section className="plugins-modal-panel" aria-labelledby="plugins-detail-about">
        <h3 id="plugins-detail-about">{t("skillsStore.about")}</h3>
        {item.longDescription ? (
          <p className="plugins-modal-description">{item.longDescription}</p>
        ) : (
          <p className="plugins-modal-empty">{t("skillsStore.noDescription")}</p>
        )}
      </section>
      <div className="plugins-modal-actions">
        {item.installed ? (
          <>
            <button className="plugins-modal-primary" type="button" onClick={() => onUninstall(item)}>
              {t("skillsStore.uninstall")}
            </button>
            <button className="plugins-modal-secondary" type="button" onClick={onClose}>
              {t("skillsStore.closeDetail")}
            </button>
          </>
        ) : (
          <>
            <button className="plugins-modal-primary" type="button" onClick={() => onInstall(item)}>
              {t("skillsStore.install")}
            </button>
            <button className="plugins-modal-secondary" type="button" onClick={onClose}>
              {t("skillsStore.closeDetail")}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}

export function PluginsView({ plugins, isLoading, query: externalQuery, onPluginsChanged }: PluginsViewProps) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  const [activeCategory, setActiveCategory] = useState<string>("__all__");
  const [selectedItem, setSelectedItem] = useState<StoreItem | null>(null);
  const query = externalQuery ?? "";
  const normalizedQuery = query.trim().toLowerCase();
  const pluginItems = useMemo(
    () => plugins.map((p) => pluginToStoreItem(p, t)),
    [plugins, t],
  );
  const matchesQuery = (item: StoreItem) =>
    !normalizedQuery ||
    item.name.toLowerCase().includes(normalizedQuery) ||
    item.description.toLowerCase().includes(normalizedQuery);
  const installedItems = useMemo(
    () => pluginItems.filter((item) => item.installed),
    [pluginItems],
  );
  const visibleInstalledItems = useMemo(
    () => installedItems.filter(matchesQuery),
    [installedItems, matchesQuery],
  );
  const visiblePlugins = useMemo(
    () => pluginItems.filter(matchesQuery),
    [pluginItems, matchesQuery],
  );
  const groupedPlugins = useMemo(
    () => groupPluginsByCategory(pluginItems),
    [pluginItems],
  );
  const categories = useMemo(
    () =>
      groupedPlugins.map((group) => ({
        key: group.key,
        label: categoryLabel(group.key, t),
        count: group.items.filter(matchesQuery).length,
      })),
    [groupedPlugins, matchesQuery, t],
  );
  useEffect(() => {
    if (activeCategory === "__all__") {
      return;
    }
    const stillExists = categories.some((category) => category.key === activeCategory);
    if (!stillExists) {
      setActiveCategory("__all__");
    }
  }, [activeCategory, categories]);
  const filteredPlugins = useMemo(() => {
    if (activeCategory === "__all__") {
      return visiblePlugins;
    }
    return visiblePlugins.filter((item) => categoryKey(item.category ?? "") === activeCategory);
  }, [activeCategory, visiblePlugins]);
  const handleOpenItem = (item: StoreItem) => {
    setSelectedItem(item);
  };
  const handleInstallItem = async (item: StoreItem) => {
    try {
      await installPlugin(item.id.replace(/^plugin:/, ""));
      onPluginsChanged?.();
    } catch (error) {
      console.error("[PluginsView] failed to install plugin", error);
    }
  };
  const handleUninstallItem = async (item: StoreItem) => {
    try {
      await uninstallPlugin(item.id.replace(/^plugin:/, ""));
      onPluginsChanged?.();
      setSelectedItem(null);
    } catch (error) {
      console.error("[PluginsView] failed to uninstall plugin", error);
    }
  };

  return (
    <>
      <div className="plugins-content">
        {visibleInstalledItems.length > 0 ? (
          <section className="plugins-installed-section" aria-label={t("skillsStore.installed")}>
            <header className="plugins-installed-header">
              <span className="plugins-installed-title">{t("skillsStore.installed")}</span>
            </header>
            <div className="plugins-installed-grid" role="list">
              {visibleInstalledItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={`plugins-installed-tile${selectedItem?.id === item.id ? " is-selected" : ""}`}
                  onClick={() => handleOpenItem(item)}
                  aria-label={t("skillsStore.itemInstalled", { name: item.name })}
                  title={item.name}
                >
                  <span
                    className={`plugins-icon ${item.iconClassName}${item.iconSrc ? " plugins-icon--image" : ""}`}
                    style={item.brandColor ? { backgroundColor: item.brandColor } : undefined}
                    aria-hidden
                  >
                    {item.iconSrc ? (
                      <img className="plugins-icon-image" src={item.iconSrc} alt="" />
                    ) : (
                      item.iconLabel
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {categories.length > 0 ? (
          <div className="plugins-category-bar" role="tablist" aria-label={t("skillsStore.pluginsTitle")}>
            {categories.map((category) => (
              <button
                key={category.key}
                type="button"
                role="tab"
                aria-selected={activeCategory === category.key}
                className={`plugins-category-chip${activeCategory === category.key ? " is-active" : ""}`}
                onClick={() => setActiveCategory(category.key)}
              >
                <span>{category.label}</span>
                <span className="plugins-category-count">{category.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="plugins-list-shell">
          {filteredPlugins.length > 0 ? (
            <div className="plugins-list">
              {filteredPlugins.map((item) => (
                <StoreItemRow key={item.id} item={item} onOpen={handleOpenItem} onInstall={handleInstallItem} />
              ))}
            </div>
          ) : (
            <div className="plugins-empty">
              {isLoading
                ? t("skillsStore.refresh")
                : pluginItems.length === 0
                  ? t("skillsStore.noPlugins")
                  : t("skillsStore.noRecommendedPlugins")}
            </div>
          )}
        </div>
      </div>
      {selectedItem ? (
        <PluginStoreDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onInstall={handleInstallItem}
          onUninstall={handleUninstallItem}
        />
      ) : null}
    </>

  );
}
