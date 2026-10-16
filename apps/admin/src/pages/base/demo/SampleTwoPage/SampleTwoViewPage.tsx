import { DemoDetailPage } from "@/components/base/crud/DemoDetailPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { sampleTwoModule } from "../SampleTwoModule";

/**
 * 示範項目詳情(隱藏頁模組 `demo.sample-two.view-page`,網址 `/demo/sample-two/view-page/<id>`)。
 *
 * 欄位表只有三列(備註 / 啟用 / 建立者)—— 對照組沒有欄位級權限、沒有封面與附件,
 * 所以這一頁看不到示範模組1 的那幾列。
 */
export const SampleTwoViewPage = (props: ModulePageProps) => (
  <DemoDetailPage config={sampleTwoModule} {...props} />
);
