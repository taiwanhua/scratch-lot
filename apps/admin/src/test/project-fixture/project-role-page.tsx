import type { ModulePageProps } from "../../lib/base/module-tree";

/**
 * 測試專案對治理頁(角色管理)的替換:同一個網址、同一筆 `me.modules`,內容換成專案版。
 * 不打任何 api —— 底座的角色管理頁若被渲染會送查詢而讓測試紅(MSW 未處理的請求視為錯誤)。
 */
export const ProjectRolePage = ({ module }: ModulePageProps) => (
  <section aria-label="專案角色頁">
    <h2>{module.name}(專案客製)</h2>
  </section>
);
