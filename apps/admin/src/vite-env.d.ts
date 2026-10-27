/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** build 時烘入的版本(`scripts/app-version-plugin.mjs`);`vite dev` / mock 模式沒有 */
  readonly APP_VERSION?: string;
}
