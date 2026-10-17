import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

const storageKeys = createAdminStorageKeys(projectPublic.slug);

/**
 * admin 的外觀(跟隨系統 / 亮 / 暗)記在 localStorage,由 `@repo/ui` 的 `AppThemeProvider` 讀寫
 * (`useColorMode`);key 由專案設定的 slug 生成(`<slug>-admin-color-mode`),登記於 docs/branding.md。
 * 首幀腳本(`color-mode-init.ts`,由 Vite 注入 html)用同一組 key 先把 `<html>` 的 class 設好,避免選了暗色重新整理先閃亮色。
 */
export const COLOR_MODE_STORAGE_KEY = storageKeys.colorMode;

/** MUI 另記亮 / 暗各自的配色名稱,實際的 key 是 `<前綴>-light` / `<前綴>-dark`。 */
export const COLOR_SCHEME_STORAGE_KEY = storageKeys.colorScheme;
