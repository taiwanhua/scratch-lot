import { DemoDetailPage } from "@/components/base/crud/DemoDetailPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { sampleOneModule } from "../SampleOneModule";

/**
 * 示範項目詳情(隱藏頁模組 `demo.sub.sample-one.view-page`;Figma 175:318)。
 *
 * 版型與行為全在共用的 `DemoDetailPage`;這一頁要示範的三件事都由設定物件表達:
 * 內部備註那一列的 `isVisible`(欄位級權限)、封面的公開穩定網址、附件的私有現簽。
 */
export const SampleOneViewPage = (props: ModulePageProps) => (
  <DemoDetailPage config={sampleOneModule} {...props} />
);
