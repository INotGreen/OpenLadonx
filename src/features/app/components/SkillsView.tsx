import Check from "lucide-react/dist/esm/icons/check";
import CircleEllipsis from "lucide-react/dist/esm/icons/circle-ellipsis";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import { useMemo, useState } from "react";
import type { SkillOption } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";

type SkillsViewProps = {
  skills: SkillOption[];
  onUseSkill?: (skill: SkillOption) => void;
  query?: string;
};

type StoreItem = {
  id: string;
  name: string;
  description: string;
  iconLabel: string;
  iconClassName: string;
  iconSrc?: string;
  installed: boolean;
  skill?: SkillOption;
  details?: string[];
};

function skillToStoreItem(skill: SkillOption, t: (key: string, options?: any) => any): StoreItem {
  return {
    id: `skill:${skill.path}:${skill.name}`,
    name: skill.name,
    description: skill.description || String(t("skillsStore.workspaceSkill")),
    iconLabel: skill.name.slice(0, 2).toUpperCase(),
    iconClassName: "skills-store-icon--skill",
    iconSrc: skill.iconDataUrl,
    installed: true,
    skill,
    details: [skill.path],
  };
}

function StoreItemRow({
  item,
  onOpen,
}: {
  item: StoreItem;
  onOpen: (item: StoreItem) => void;
}) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  return (
    <article
      className="skills-store-item"
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
        className={`skills-store-icon ${item.iconClassName}${item.iconSrc ? " skills-store-icon--image" : ""}`}
        aria-hidden
      >
        {item.iconSrc ? (
          <img className="skills-store-icon-image" src={item.iconSrc} alt="" />
        ) : (
          item.iconLabel
        )}
      </div>
      <div className="skills-store-item-copy">
        <div className="skills-store-item-title">{item.name}</div>
        <div className="skills-store-item-description">{item.description}</div>
      </div>
      <button
        className={`skills-store-item-action${
          item.installed ? " skills-store-item-action--installed" : ""
        }`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(item);
        }}
        aria-label={item.installed ? t("skillsStore.itemInstalled", { name: item.name }) : t("skillsStore.installItem", { name: item.name })}
      >
        {item.installed ? <Check size={20} aria-hidden /> : <Plus size={20} aria-hidden />}
      </button>
    </article>
  );
}

function SkillStoreDetail({
  item,
  onClose,
  onUseSkill,
}: {
  item: StoreItem;
  onClose: () => void;
  onUseSkill?: (skill: SkillOption) => void;
}) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  const detailLines = item.details?.filter(Boolean) ?? [];

  return (
    <ModalShell
      className="skills-store-modal"
      cardClassName="skills-store-modal-card"
      onBackdropClick={onClose}
      ariaLabel={t("skillsStore.detailAriaLabel", { name: item.name })}
    >
      <div className="skills-store-modal-header">
        <div
          className={`skills-store-modal-icon ${item.iconClassName}${item.iconSrc ? " skills-store-icon--image" : ""}`}
          aria-hidden
        >
          {item.iconSrc ? (
            <img className="skills-store-icon-image" src={item.iconSrc} alt="" />
          ) : (
            item.iconLabel
          )}
        </div>
        <button className="skills-store-modal-close" type="button" onClick={onClose} aria-label={t("skillsStore.closeDetail")}>
          <X size={24} aria-hidden />
        </button>
      </div>
      <div className="skills-store-modal-title-row">
        <div>
          <h2 className="skills-store-modal-title">{item.name}</h2>
          <div className="skills-store-modal-type">{t("skillsStore.skillsTab")}</div>
        </div>
        <div className="skills-store-modal-status-row">
          <div
            className={`skills-store-modal-status${item.installed ? " is-on" : ""}`}
            aria-label={item.installed ? t("skillsStore.itemInstalled", { name: item.name }) : t("skillsStore.notInstalled", { name: item.name })}
          >
            <span className="skills-store-modal-status-thumb" />
          </div>
          <button className="skills-store-modal-more" type="button" aria-label={t("skillsStore.moreActions")}>
            <CircleEllipsis size={18} aria-hidden />
          </button>
        </div>
      </div>
      <p className="skills-store-modal-description">{item.description}</p>
      <section className="skills-store-modal-panel" aria-labelledby="skills-store-detail-about">
        <h3 id="skills-store-detail-about">{t("skillsStore.about")}</h3>
        {detailLines.length > 0 ? (
          <ul className="skills-store-modal-list">
            {detailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="skills-store-modal-empty">{t("skillsStore.noDescription")}</p>
        )}
      </section>
      <div className="skills-store-modal-actions">
        {item.installed && item.skill ? (
          <button
            className="skills-store-modal-primary"
            type="button"
            onClick={() => {
              if (item.skill) {
                onUseSkill?.(item.skill);
              }
              onClose();
            }}
          >
            {t("skillsStore.tryInChat")}
          </button>
        ) : (
          <button className="skills-store-modal-primary" type="button" disabled>
            {t("skillsStore.installItem", { name: item.name })}
          </button>
        )}
        <button className="skills-store-modal-secondary" type="button" disabled>
          {item.installed ? t("skillsStore.uninstall") : t("skillsStore.install")}
        </button>
      </div>
    </ModalShell>
  );
}

export function SkillsView({ skills, onUseSkill, query: externalQuery }: SkillsViewProps) {
  const { t: tRaw } = useI18nSafe();
  const t = (key: string, options?: any) => String(tRaw(key, options));
  const [selectedItem, setSelectedItem] = useState<StoreItem | null>(null);
  const query = externalQuery ?? "";
  const normalizedQuery = query.trim().toLowerCase();
  const installedSkillItems = useMemo(
    () => skills.map((s) => skillToStoreItem(s, t)),
    [skills, t],
  );
  const matchesQuery = (item: StoreItem) =>
    !normalizedQuery ||
    item.name.toLowerCase().includes(normalizedQuery) ||
    item.description.toLowerCase().includes(normalizedQuery);
  const visibleInstalledSkills = installedSkillItems.filter(matchesQuery);
  const handleOpenItem = (item: StoreItem) => {
    setSelectedItem(item);
  };

  return (
    <>
      <div className="skills-store-content">
        <section className="skills-store-section" aria-labelledby="skills-store-installed-title">
          <h2 id="skills-store-installed-title">{t("skillsStore.installed")}</h2>
          {visibleInstalledSkills.length > 0 ? (
            <div className="skills-store-list">
              {visibleInstalledSkills.map((item) => (
                <StoreItemRow item={item} key={item.id} onOpen={handleOpenItem} />
              ))}
            </div>
          ) : (
            <div className="skills-store-empty">{t("skillsStore.noInstalledSkills")}</div>
          )}
        </section>
      </div>
      {selectedItem ? (
        <SkillStoreDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUseSkill={onUseSkill}
        />
      ) : null}
    </>
  );
}
