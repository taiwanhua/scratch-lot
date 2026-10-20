import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "@/test/msw/auth-handlers";
import { fieldsByCategory } from "@/test/msw/field-fixtures";
import { dealersModules } from "@/test/msw/project/dealers-fixtures";
import { dealersWorld } from "@/test/msw/project/dealers-handlers";
import { fieldOptionColorWorld } from "@/test/msw/project/field-option-colors-handlers";
import { masterDataModules } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataWorld } from "@/test/msw/project/lottery/master-data-handlers";

import type { ProjectMockWorld } from "../mock-world-source";

/** 欄位管理(客製替換頁)的選項顏色:示範分類三筆有顏色,其餘「不設定」。 */
const fieldOptionColors = () =>
  fieldOptionColorWorld({
    colorsByCategory: {
      "demo-category": [
        { fieldId: "f-staple", value: "staple", paletteKey: "green" },
        { fieldId: "f-side-dish", value: "side-dish", paletteKey: "yellow" },
        { fieldId: "f-fried", value: "fried", paletteKey: "orange" },
      ],
    },
    options: Object.fromEntries(
      Object.values(fieldsByCategory)
        .flat()
        .map((field) => [
          field.id,
          {
            categoryKey:
              field.categoryId === "cat-gender" ? "gender" : "demo-category",
            value: field.value,
          },
        ]),
    ),
  }).handlers;

/** 輸出報表(seed `apps/db-migrator/seeds/project/reports.ts`;權限給滿)。 */
const reportsModule: TestModule = {
  id: "m-reports",
  key: "reports",
  name: "輸出報表",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 50,
  route: "/reports",
  icon: "chart",
  permissions: ["reports.*"],
};

/**
 * 專案的 mock world:專案新增的模組在此登記 mock 模式的模組清單與假 api,底座更新不會動到這份。
 *
 * - `modules`:該視角側欄要多出的模組(與 seed 宣告一致,權限給滿才點得到每一頁)
 * - `handlers`:專案頁的假 api,夾具取自 `src/test/msw/project/`(與元件測試共用)
 */
export const projectMockWorld: ProjectMockWorld = {
  // 檔案管理、經銷商管理:權限給滿(經銷商兩個批購基準日的欄位級權限也有),各分頁都看得到;輸出報表同樣給滿
  modules: () => [...masterDataModules(), ...dealersModules(), reportsModule],
  handlers: () => [
    ...fieldOptionColors(),
    ...masterDataWorld().handlers,
    ...dealersWorld().handlers,
  ],
};
