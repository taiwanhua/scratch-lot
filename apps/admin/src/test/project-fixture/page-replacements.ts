import type { ModulePageReplacement } from "../../app/module-page-registry";
import { ProjectDesignerPage } from "./project-designer-page";
import { ProjectRolePage } from "./project-role-page";

/**
 * `app/project/page-replacements.ts` 的測試專案版:替換兩個底座治理頁。
 * 角色管理沒寫 `minWidth` —— 沿用底座(底座頁目前都沒宣告,即殼層預設 `lg`);
 * 表單管理明寫 `xl` —— 驗「替換頁明寫寬度」走得通真組裝入口(底座已不宣告 `xl`,T48)。
 * 模組 key 寫字面值:測試支援檔不 import 底座頁的內部(專案的寫法也應如此)。
 */
export const projectPageReplacements: readonly ModulePageReplacement[] = [
  { target: "system.role-manager", Page: ProjectRolePage },
  { target: "system.forms", Page: ProjectDesignerPage, minWidth: "xl" },
];
