import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export function guildName() {
  return document.getElementById("mapper-root")?.dataset.guildName || "Avalon Roads";
}

export function GuildIcon({ url }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const custom = url && !broken;
  return <span className={`brand-mark${custom ? " has-image" : ""}`}>
    {custom ? <img src={url} alt="" width="37" height="37" onError={() => setBroken(true)} /> : <Icon name="compass" size={25} />}
  </span>;
}

export function Brand({ page = "boards", onMaps, onMembers, showMaps = true, iconUrl }) {
  const { t } = useTranslation("mapper");
  return <div className="brand-area">
    <a href="/" className="brand" aria-label={guildName()}>
      <GuildIcon url={iconUrl === undefined ? document.getElementById("mapper-root")?.dataset.guildIconUrl : iconUrl} />
      <span className="guild-name">{guildName()}</span>
    </a>
    {(showMaps || onMembers) && <span className="brand-divider" />}
    <nav className="brand-nav" aria-label={guildName()}>
      {showMaps && <button className={`brand-product${page === "boards" ? " active" : ""}`} aria-current={page === "boards" ? "page" : undefined} onClick={onMaps || (() => location.assign("/"))}>{t("page.product")}</button>}
      {onMembers && <button className={`brand-product${page === "members" ? " active" : ""}`} aria-current={page === "members" ? "page" : undefined} onClick={onMembers}>{t("members.title")}</button>}
    </nav>
  </div>;
}
