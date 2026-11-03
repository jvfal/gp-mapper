import { useTranslation } from "react-i18next";
import { changeLanguage } from "./i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation("common");
  return (
    <select
      className="language-switcher"
      aria-label={t("language")}
      value={i18n.resolvedLanguage}
      onChange={(event) => changeLanguage(event.target.value)}
    >
      <option value="pt-BR">Português (BR)</option>
      <option value="en-US">English (US)</option>
      <option value="es">Español</option>
    </select>
  );
}
