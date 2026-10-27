import { APP_VERSION_PATH } from "../src/lib/base/app-version.ts";

/**
 * 版本號的 Vite 外掛(只接正式入口 `vite.config.ts`,且只在 build 生效;`vite dev` 與 mock 入口沒有版本 →
 * 新版本提示不啟動)。執行期的偵測在 `src/lib/base/app-version.ts` / `hooks/base/useAppUpdateNotice.ts`。
 *
 * 同一個值寫兩處:烘進 bundle 的 `import.meta.env.APP_VERSION`,與輸出的 `version.json`(nginx 對它 `no-cache`)。
 * 已開著的舊分頁抓到的 `version.json` 與自己烘的值不同 = 已部署新版。
 */

/**
 * 版本的來源:build 環境的 `APP_VERSION`(部署時 deploy.yml 以 `--build-arg` 傳入這次的 commit SHA),
 * 沒有就用 build 時間 —— 本機 build 每次都不同,同樣分得出新舊。
 */
export const resolveAppVersion = (env = process.env, now = () => new Date()) =>
  env.APP_VERSION?.trim() || now().toISOString();

/** `version.json` 的內容。 */
export const appVersionSource = (version) => `${JSON.stringify({ version })}\n`;

export const appVersionPlugin = (version = resolveAppVersion()) => ({
  name: "admin:app-version",
  apply: "build",
  config: () => ({
    define: { "import.meta.env.APP_VERSION": JSON.stringify(version) },
  }),
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: APP_VERSION_PATH.slice(1),
      source: appVersionSource(version),
    });
  },
});
