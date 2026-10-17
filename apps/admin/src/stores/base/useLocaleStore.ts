import { create } from "zustand";
import { type PersistStorage, persist } from "zustand/middleware";

import { type Locale, defaultLocale } from "@repo/i18n";

import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "../../lib/base/locale";

interface LocalePersisted {
  locale: Locale;
}

export interface LocaleState extends LocalePersisted {
  setLocale: (locale: Locale) => void;
}

/**
 * localStorage 存的是語言代碼字串本身(`"en"`),不是 zustand 的 JSON 封包 — 沿用重構前的格式與 key(docs/branding.md),
 * 既存值不失效;讀不到或不合法退回預設語言。
 */
const storage: PersistStorage<LocalePersisted> = {
  getItem: () => ({ state: { locale: readStoredLocale() } }),
  setItem: (_name, value) => {
    writeStoredLocale(value.state.locale);
  },
  removeItem: () => {
    try {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    } catch {
      // localStorage 不可用時本來就沒存,不需處理
    }
  },
};

/** admin 目前的語言(I18N-05:跟著帳號,這裡是本機快取);頭像選單的「語言」與登入後的帳號同步(`useAccountLocale`)寫入、AppProviders 讀給 IntlProvider。 */
export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: defaultLocale,
      setLocale: (locale) => {
        set({ locale });
      },
    }),
    {
      name: LOCALE_STORAGE_KEY,
      storage,
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
