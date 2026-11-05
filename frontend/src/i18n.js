import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ptCommon from "./locales/pt-BR/common.json";
import ptMapper from "./locales/pt-BR/mapper.json";
import enCommon from "./locales/en-US/common.json";
import enMapper from "./locales/en-US/mapper.json";
import esCommon from "./locales/es/common.json";
import esMapper from "./locales/es/mapper.json";

export const LANGUAGE_KEY = "avalon-roads:language";
export const LANGUAGE_COOKIE = "avalon_roads_language";
export const supportedLanguages = ["pt-BR", "en-US", "es"];

function supportedLanguage(value) {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return { pt: "pt-BR", en: "en-US", es: "es" }[base];
}

function detectLanguage() {
  try {
    const preference = supportedLanguage(localStorage.getItem(LANGUAGE_KEY));
    if (preference) return preference;
  } catch {
    /* Browser storage may be unavailable. */
  }
  try {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${LANGUAGE_COOKIE}=`));
    const preference =
      cookie && supportedLanguage(decodeURIComponent(cookie.split("=")[1]));
    if (preference) return preference;
  } catch {
    /* Ignore malformed cookies and use browser preferences. */
  }
  for (const language of navigator.languages || [navigator.language]) {
    const supported = supportedLanguage(language);
    if (supported) return supported;
  }
  return "en-US";
}

function updateDocument(language) {
  document.documentElement.lang = language;
  document.title = i18n.t("mapper:page.title", {
    guild: document.getElementById("mapper-root")?.dataset.guildName || "Avalon Roads",
  });
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", i18n.t("mapper:page.description"));
}

i18n.on("languageChanged", updateDocument);
i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { common: ptCommon, mapper: ptMapper },
    "en-US": { common: enCommon, mapper: enMapper },
    es: { common: esCommon, mapper: esMapper },
  },
  lng: detectLanguage(),
  fallbackLng: "en-US",
  supportedLngs: supportedLanguages,
  load: "currentOnly",
  defaultNS: "mapper",
  ns: ["common", "mapper"],
  initAsync: false,
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export function changeLanguage(language) {
  if (!supportedLanguages.includes(language)) return;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* Selection still works for this visit. */
  }
  document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return i18n.changeLanguage(language);
}

export default i18n;
