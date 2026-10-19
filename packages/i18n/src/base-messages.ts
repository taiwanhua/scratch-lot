import enAdmin from "../messages/en/admin.json" with { type: "json" };
import enCommon from "../messages/en/common.json" with { type: "json" };
import enFront from "../messages/en/front.json" with { type: "json" };
import enProjectAdmin from "../messages/en/project/admin.json" with { type: "json" };
import enProjectAdminReplacements from "../messages/en/project/admin.replacements.json" with { type: "json" };
import zhAdmin from "../messages/zh-TW/admin.json" with { type: "json" };
import zhCommon from "../messages/zh-TW/common.json" with { type: "json" };
import zhFront from "../messages/zh-TW/front.json" with { type: "json" };
import zhProjectAdmin from "../messages/zh-TW/project/admin.json" with { type: "json" };
import zhProjectAdminReplacements from "../messages/zh-TW/project/admin.replacements.json" with { type: "json" };
import type { Locale, defaultLocale } from "./locales";
import { composeAdminMessages } from "./project-admin-messages";

/**
 * 基礎字典(唯一的組裝處)。`admin` 是底座 `admin.json` 併入專案的後台文案
 * (`project/admin.json` 新增、`project/admin.replacements.json` 替換;規則見 `project-admin-messages.ts`)。
 * `common.brand` 與 `front.meta` 是中性預設,app 經 `composeProjectMessages` 注入專案值後才交給翻譯函式(I18N-06)。
 */
export const messages = {
  "zh-TW": {
    common: zhCommon,
    front: zhFront,
    admin: composeAdminMessages({
      locale: "zh-TW",
      base: zhAdmin,
      additions: zhProjectAdmin,
      replacements: zhProjectAdminReplacements,
    }),
  },
  en: {
    common: enCommon,
    front: enFront,
    admin: composeAdminMessages({
      locale: "en",
      base: enAdmin,
      additions: enProjectAdmin,
      replacements: enProjectAdminReplacements,
    }),
  },
} satisfies Record<Locale, Record<string, unknown>>;

export type Messages = (typeof messages)[typeof defaultLocale];
