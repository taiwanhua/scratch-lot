import { DemoFormPage } from "@/components/base/crud/DemoFormPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { sampleOneModule } from "../SampleOneModule";

/**
 * 新增 / 編輯示範項目(隱藏頁模組 `create-page` / `edit-page`,**共版型**;Figma 175:558)。
 *
 * 兩個模組 key 都登記到這一個元件,情境由 `module.key` 判斷(共用的 `DemoFormPage` 做這件事)。
 * 欄位、上傳欄、兩個頁面自有區塊(填寫提示 / 變更歷程)都在設定物件裡。
 */
export const SampleOneFormPage = (props: ModulePageProps) => (
  <DemoFormPage config={sampleOneModule} {...props} />
);
