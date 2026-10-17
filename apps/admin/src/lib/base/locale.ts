import { type Locale, defaultLocale, isLocale } from "@repo/i18n";
import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

/**
 * admin 的語言跟著帳號(I18N-05;規格 10.6):正本是 `user_preferences.settings.locale`,
 * 本機這一份是**快取** —— 登入前(登入頁、設定密碼頁)與登入後第一個畫面用它,不必等 api;
 * 登出後保留。key 由專案設定的 slug 生成(`<slug>-admin-locale`),登記於 docs/branding.md。
 */
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

/** 帳號偏好裡的語言 key(api `LOCALE_PREFERENCE_KEY`)。 */
export const ACCOUNT_LOCALE_KEY = "locale";

export interface AccountLocaleDecision {
  /** 登入後要用的語言 */
  locale: Locale;
  /** 帳號還沒有語言設定:把本機快取寫回帳號 */
  writeBack: boolean;
}

/**
 * 登入後該用哪個語言(規格 10.6 情境表):
 * - 帳號有語言設定(且是支援的語言)→ 用帳號的,並覆寫本機快取
 * - 帳號沒有(新帳號)或是認不得的值 → 用本機快取(沒有快取時快取就是預設語言),並寫回帳號
 */
export const resolveAccountLocale = (
  accountLocale: unknown,
  cached: Locale,
): AccountLocaleDecision =>
  typeof accountLocale === "string" && isLocale(accountLocale)
    ? { locale: accountLocale, writeBack: false }
    : { locale: cached, writeBack: true };
