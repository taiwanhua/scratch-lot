import type { ProjectMockWorld } from "../mock-world-source";

/**
 * 專案的 mock world:專案新增的模組在此登記 mock 模式的模組清單與假 api,底座更新不會動到這份。
 *
 * - `modules`:該視角側欄要多出的模組(與 seed 宣告一致,權限給滿才點得到每一頁)
 * - `handlers`:專案頁的假 api,夾具取自 `src/test/msw/project/`(與元件測試共用)
 */
export const projectMockWorld: ProjectMockWorld = {
  modules: () => [],
  handlers: () => [],
};
