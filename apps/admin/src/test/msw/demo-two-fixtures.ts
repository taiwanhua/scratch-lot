import type { TestDemoItemTwo } from "./demo-sample-two-handlers";

/**
 * 示範模組2 的夾具。形狀以 `docs/modules/demo.sample-two.md`「api 介面」為準(TEST-08):
 * 只有 name / note / enabled + 基礎欄位,`abilities` 由 api 逐筆算好(已含權限判斷),
 * `createdBy` 查不到人時是 null(示範資料的建立者是假 ObjectId)。
 *
 * 與示範模組1 的夾具分開一份:兩邊的欄位本來就不一樣,共用一份會讓「對照組沒有那些欄位」
 * 這件事在測試裡看不出來。
 */

const item = (
  id: string,
  name: string,
  overrides: Partial<TestDemoItemTwo> = {},
): TestDemoItemTwo => ({
  id,
  name,
  note: null,
  enabled: true,
  createdBy: null,
  createdAt: "2026-09-01T01:05:00.000Z",
  updatedAt: "2026-09-10T06:22:00.000Z",
  abilities: { canEdit: true, canDelete: true },
  shareOrgs: [],
  isShared: false,
  ...overrides,
});

/**
 * 三筆,分別驗三件事:
 * - 對照組項目A:備註與建立者都有 → 詳情頁每一列都有東西可看
 * - 對照組項目B:備註與建立者都空的 → 驗「沒填顯示『—』」
 * - 對照組項目C:停用 + `abilities` 全關 → 驗啟用標籤與「沒有權限就沒有那顆按鈕」
 */
export const demoTwoItems: TestDemoItemTwo[] = [
  item("demo-two-1", "對照組項目A", {
    note: "沒有分類、沒有狀態的對照資料",
    createdBy: { id: "user-ming", name: "王小明" },
  }),
  item("demo-two-2", "對照組項目B"),
  item("demo-two-3", "對照組項目C", {
    note: "已停用的對照資料",
    enabled: false,
    abilities: { canEdit: false, canDelete: false },
  }),
];
