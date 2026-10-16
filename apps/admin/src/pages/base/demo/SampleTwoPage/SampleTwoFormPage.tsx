import { DemoFormPage } from "@/components/base/crud/DemoFormPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { sampleTwoModule } from "../SampleTwoModule";

/**
 * 新增 / 編輯示範項目(隱藏頁模組 `create-page` / `edit-page`,**共版型**)。
 *
 * 兩個模組 key 都登記到這一個元件,情境由 `module.key` 判斷;表單只有名稱與備註
 * (`enabled` 不在表單上 —— 它由 `setDemoItemTwoEnabled` 單獨切換)。
 */
export const SampleTwoFormPage = (props: ModulePageProps) => (
  <DemoFormPage config={sampleTwoModule} {...props} />
);
