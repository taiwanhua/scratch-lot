import { type Locale, defaultLocale, isLocale } from "@repo/i18n";
import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

/** admin 的語言不進 URL,記在 localStorage(I18N-05);key 由專案設定的 slug 生成(`<slug>-admin-locale`),登記於 docs/branding.md。 */
export const LOCALE_STORAGE_KEY = createAdminStorageKeys(
  projectPublic.slug,
).locale;

/** 讀回上次選的語言;讀不到或不是支援的語言一律回預設語言。 */
export const readStoredLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored !== null && isLocale(stored)) {
      return stored;
    }
  } catch {
    // localStorage 不可用(隱私模式等)時退回預設語言
  }
  return defaultLocale;
};

export const writeStoredLocale = (locale: Locale): void => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 寫不進去就只影響本次(下次開啟回預設語言),不阻擋切換
  }
};
