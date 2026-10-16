import { isProjectSlug } from "./public-config";

/**
 * admin 的瀏覽器儲存鍵(localStorage / sessionStorage / BroadcastChannel 共用同一套命名)。
 * 格式固定 `<slug>-admin-<用途>`;需要再分把的鍵由消費端自己接後綴:
 * 路由頁籤與區塊收合附加 `:<userId>`,MUI 在 colorScheme 後附加 `-light` / `-dark`。
 */
export interface AdminStorageKeys {
  /** localStorage:介面語言 */
  locale: string;
  /** localStorage:外觀(跟隨系統 / 亮 / 暗) */
  colorMode: string;
  /** localStorage:亮 / 暗各自的配色名稱(前綴) */
  colorScheme: string;
  /** sessionStorage:路由頁籤(前綴) */
  routeTabsPrefix: string;
  /** BroadcastChannel:分頁間的登入狀態同步 */
  sessionChannel: string;
  /** localStorage:側欄收合狀態 */
  sideNav: string;
  /** localStorage:頁面可收合區塊(Section)的收合狀態(前綴,每使用者一把 `:<userId>`) */
  sectionsPrefix: string;
}

export const createAdminStorageKeys = (slug: string): AdminStorageKeys => {
  if (!isProjectSlug(slug)) {
    throw new Error(
      `無法生成 admin 儲存鍵:slug 必須是非空的小寫 kebab-case(收到 ${JSON.stringify(slug)})`,
    );
  }
  const prefix = `${slug}-admin`;
  return {
    locale: `${prefix}-locale`,
    colorMode: `${prefix}-color-mode`,
    colorScheme: `${prefix}-color-scheme`,
    routeTabsPrefix: `${prefix}-route-tabs`,
    sessionChannel: `${prefix}-session`,
    sideNav: `${prefix}-sidenav`,
    sectionsPrefix: `${prefix}-sections`,
  };
};
