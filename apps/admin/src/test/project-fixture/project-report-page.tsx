import type { ModulePageProps } from "../../lib/base/module-tree";

/** 測試專案新增的頁面:只印得出「這是專案頁」與殼傳進來的模組名。 */
export const ProjectReportPage = ({ module }: ModulePageProps) => (
  <section aria-label="專案報表頁">
    <h2>{module.name}(專案新增)</h2>
  </section>
);
