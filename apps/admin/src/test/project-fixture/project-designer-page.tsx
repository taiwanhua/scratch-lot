import type { ModulePageProps } from "../../lib/base/module-tree";

/** 測試專案對表單管理頁的替換:沒有宣告寬度,用來驗「沿用底座那一頁的寬度」。 */
export const ProjectDesignerPage = ({ module }: ModulePageProps) => (
  <section aria-label="專案表單管理頁">
    <h2>{module.name}(專案客製)</h2>
  </section>
);
