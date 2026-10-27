/**
 * 每台裝置記住上次選的檢視(規格 14.5:電腦預設班表、手機預設日)。存瀏覽器;讀寫失敗(私密視窗、
 * 封鎖網站資料)時照預設、不記住。
 */
const STORAGE_KEY = "schedule.roster.view";

export const readRosterView = (): string | null => {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const writeRosterView = (view: string): void => {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // 不記住也照常切換
  }
};
