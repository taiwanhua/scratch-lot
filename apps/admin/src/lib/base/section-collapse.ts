import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

/**
 * 可收合區塊(`Section`)的收合狀態記憶(底座 10.3)。
 *
 * - localStorage key `<slug>-admin-sections:<userId>`(前綴由 `createAdminStorageKeys(slug).sectionsPrefix` 生成,
 *   登記於 docs/branding.md);每個使用者一把,換人登入讀另一把
 * - 內容依頁面分組 `{ "<頁面 id>": { "<區塊 key>": boolean } }`(值 = 是否收合),例
 *   `{ "dealers.detail": { "license": false }, "form:purchase": { "notes": true } }`
 * - **只記與預設值不同的**;改回預設就刪那一筆,頁面底下空了就刪頁面;不設上限
 * - 清除該頁已不存在的區塊 key 由呼叫端決定時機(表單引擎只在渲染目前版本時清;一般頁面不自動清);讀不到(不可用、格式壞)一律當空 = 用預設值
 *
 * 頁面 id:一般頁面 `<模組 key>.create` / `.edit` / `.detail`(三者分開記);表單引擎 `form:<formKey>`(新增、編輯、檢視共用,不分版本)。
 * 本檔是純函式 + 讀寫;元件端入口是 `hooks/base/useSectionCollapse.ts`。
 */

/** 一頁的紀錄:區塊 key → 是否收合(只有與預設不同的才在裡面)。 */
export type SectionPageStates = Readonly<Record<string, boolean>>;

/** 整把 key 的內容:頁面 id → 該頁的紀錄。 */
export type SectionStore = Readonly<Partial<Record<string, SectionPageStates>>>;

export const SECTIONS_STORAGE_PREFIX = createAdminStorageKeys(
  projectPublic.slug,
).sectionsPrefix;

export const sectionsStorageKey = (userId: string): string =>
  `${SECTIONS_STORAGE_PREFIX}:${userId}`;

/** 表單引擎的頁面 id(新增、編輯、檢視共用一組;發布新版本照舊)。 */
export const formSectionPageId = (formKey: string): string => `form:${formKey}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 只留下形狀正確的頁面與布林值;其餘(被改壞、舊格式)丟掉。 */
const sanitize = (value: unknown): SectionStore => {
  if (!isRecord(value)) {
    return {};
  }
  const store: Record<string, SectionPageStates> = {};
  for (const [pageId, page] of Object.entries(value)) {
    if (!isRecord(page)) {
      continue;
    }
    const states = Object.fromEntries(
      Object.entries(page).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
    if (Object.keys(states).length > 0) {
      store[pageId] = states;
    }
  }
  return store;
};

/** 讀整把 key;localStorage 不可用、沒有值、格式不對一律回空(= 全部用預設值)。 */
export const readSectionStore = (storageKey: string): SectionStore => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? {} : sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
};

/** 寫整把 key;空了就刪 key。localStorage 不可用時只是不記住,畫面照常。 */
export const writeSectionStore = (
  storageKey: string,
  store: SectionStore,
): void => {
  try {
    if (Object.keys(store).length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // 不可用(隱私模式、被擋、滿了):不記住,下次打開用預設值
  }
};

const withPage = (
  store: SectionStore,
  pageId: string,
  page: SectionPageStates,
): SectionStore => {
  const next = { ...store };
  if (Object.keys(page).length === 0) {
    Reflect.deleteProperty(next, pageId);
  } else {
    next[pageId] = page;
  }
  return next;
};

/** 某區塊目前是否收合:有紀錄用紀錄,沒有用預設值。 */
export const isSectionCollapsed = (
  page: SectionPageStates | undefined,
  sectionKey: string,
  defaultCollapsed: boolean,
): boolean => page?.[sectionKey] ?? defaultCollapsed;

/** 手動切換後的內容:和預設不同 → 記下;改回預設 → 刪那一筆,頁面空了刪頁面。 */
export const setSectionCollapsed = (
  store: SectionStore,
  pageId: string,
  sectionKey: string,
  collapsed: boolean,
  defaultCollapsed: boolean,
): SectionStore => {
  const page = { ...store[pageId] };
  if (collapsed === defaultCollapsed) {
    Reflect.deleteProperty(page, sectionKey);
  } else {
    page[sectionKey] = collapsed;
  }
  return withPage(store, pageId, page);
};

/** 打開某頁時:刪掉該頁已不存在的區塊 key,頁面空了刪頁面;沒有變動時回原物件。 */
export const pruneSectionPage = (
  store: SectionStore,
  pageId: string,
  existingKeys: readonly string[],
): SectionStore => {
  const page = store[pageId];
  if (page === undefined) {
    return store;
  }
  const existing = new Set(existingKeys);
  const kept = Object.fromEntries(
    Object.entries(page).filter(([sectionKey]) => existing.has(sectionKey)),
  );
  return Object.keys(kept).length === Object.keys(page).length
    ? store
    : withPage(store, pageId, kept);
};
