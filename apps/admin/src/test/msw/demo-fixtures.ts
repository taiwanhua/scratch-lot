import { DemoItemOneStatus } from "@repo/graphql";

import type {
  TestDemoHistoryEntry,
  TestDemoItem,
} from "./demo-sample-one-handlers";

/**
 * 示範模組1 的夾具。
 *
 * 形狀以 `docs/modules/demo.sub.sample-one.md`「api 介面」與 api 測試的斷言為準(TEST-08):
 * `abilities` 由 api 逐筆算好(已含權限判斷)、`coverUrl` 是公開穩定網址、
 * 附件給路徑 + 原始檔名 / 大小 / 檔型(舊資料後三者為 null)、`createdBy` 查不到人時是 null(seed 示範資料用假 ObjectId)。
 *
 * 分類的 value 對照欄位管理「示範分類」的種子選項(`field-fixtures.ts` 的 `demoCategoryFields`),
 * 兩份夾具的 value 必須一致 —— 不然列表的分類篩選在測試裡永遠篩不到東西。
 */

/** 公開 bucket 的穩定網址(不簽名、不過期,可直接放 `<img src>`)。 */
export const TEST_DEMO_COVER_URL = "https://demo-storage.test/public/cover.png";

const item = (
  id: string,
  name: string,
  overrides: Partial<TestDemoItem> = {},
): TestDemoItem => ({
  id,
  name,
  category: null,
  categoryLabel: null,
  note: null,
  internalNote: null,
  coverPath: null,
  coverUrl: null,
  attachment: null,
  status: DemoItemOneStatus.Draft,
  enabled: true,
  createdBy: null,
  createdAt: "2026-09-01T01:05:00.000Z",
  updatedAt: "2026-09-10T06:22:00.000Z",
  abilities: { canEdit: true, canDelete: true, canEditInternalNote: true },
  ...overrides,
});

/**
 * 三筆(Figma 175:3 畫的那三筆):
 * - 醬燒雞腿排:有封面、有附件、有內部備註、有建立者 → 詳情頁每一欄都有東西可看
 * - 涼拌小黃瓜:備註與建立者都是空的 → 驗「沒填顯示『—』」
 * - 古早味紅茶:停用 + 已封存 + `abilities` 全關 → 驗狀態標籤與「沒有權限就沒有那顆按鈕」
 */
export const demoItems: TestDemoItem[] = [
  item("demo-1", "醬燒雞腿排", {
    category: "staple",
    categoryLabel: "主食",
    note: "週末限定測試資料",
    internalNote: "成本試算尚未確認",
    coverPath: "demo/cover.png",
    coverUrl: TEST_DEMO_COVER_URL,
    attachment: {
      path: "demo/cost.png",
      name: "成本試算 2026.png",
      size: 1_258_291,
      contentType: "image/png",
    },
    status: DemoItemOneStatus.Published,
    createdBy: { id: "user-ming", name: "王小明" },
  }),
  item("demo-2", "涼拌小黃瓜", {
    category: "side-dish",
    categoryLabel: "小菜",
    status: DemoItemOneStatus.Draft,
  }),
  item("demo-3", "古早味紅茶", {
    category: "drink",
    categoryLabel: "飲品",
    note: "已下架的示範資料",
    status: DemoItemOneStatus.Archived,
    enabled: false,
    abilities: {
      canEdit: false,
      canDelete: false,
      canEditInternalNote: false,
    },
  }),
];

/** 變更歷程(新到舊,不分頁);`internalNote` 在歷程裡一律是 `"[redacted]"`。 */
export const demoHistory: TestDemoHistoryEntry[] = [
  {
    id: "log-2",
    action: "demo-item-one.edit",
    actor: { id: "user-ming", name: "王小明" },
    before: { note: "舊備註" },
    after: { note: "週末限定測試資料" },
    createdAt: "2026-09-10T06:22:00.000Z",
  },
  {
    id: "log-1",
    action: "demo-item-one.create",
    actor: { id: "user-ming", name: "王小明" },
    before: null,
    after: { name: "醬燒雞腿排", internalNote: "[redacted]" },
    createdAt: "2026-09-01T01:05:00.000Z",
  },
];
