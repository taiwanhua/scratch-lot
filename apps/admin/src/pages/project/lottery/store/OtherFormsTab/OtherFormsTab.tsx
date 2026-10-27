import { FormListPage } from "@/components/base/form-engine/FormModulePages/FormListPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

/**
 * 「其他申請」分頁(規格 6.1):租戶自己綁到店面管理的表單,沿用表單引擎的預設列表(搜尋、篩選、新增、作廢)。
 */
export const OtherFormsTab = (props: ModulePageProps) => (
  <FormListPage {...props} />
);
