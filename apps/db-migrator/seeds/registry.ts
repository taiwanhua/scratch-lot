import type { DemoSource } from "../src/demo/demo-source";
import {
  SeedCompositionError,
  composeSeedRegistry,
  registerAssembledLookupProviders,
} from "../src/seed/seed-composition";
import type { SeedRegistry } from "../src/seed/seed-declaration";
import { findSeedKeyViolations } from "../src/seed/seed-key-convention";
import { composeModuleSeeds } from "./base/modules";
import { createBaseSeedRegistry } from "./base/registry";
import {
  type ProjectSeedSettings,
  type SeedSource,
  assertProjectSeedSettings,
} from "./base/seed-source";
import { projectDemoSource, projectSeedSource } from "./project/registry";
import { projectSeedSettings } from "./project/settings";

/**
 * 把底座與專案兩個來源合成一份 registry(正本:ADR-0002)。**唯一**讀兩方來源的地方:
 *
 * 1. 驗專案初值,傳給底座工廠(`base/` 不 import `project/`)
 * 2. 合併兩方的模組宣告,`composeModuleSeeds` **只推導一次** modules / permissions / 資料範圍目標 /
 *    租戶管理員模板 —— 專案的子模組可以掛在底座父節點底下,模板也因此納入專案新增的模組
 * 3. 與兩方的普通種子、定義宣告一起驗(撞 key、引用、循環、推導類與版本化定義的防線)並依引用排出執行順序
 *
 * 全部在寫入之前完成;任何一項不合就丟錯,不會靠載入先後覆蓋。
 */
export function assembleSeedRegistry(
  settings: ProjectSeedSettings,
  project: SeedSource,
): SeedRegistry {
  const { moduleInitialValues } = assertProjectSeedSettings(settings);
  const base = createBaseSeedRegistry(settings);
  const moduleSeeds = composeModuleSeeds(
    [...base.moduleDeclarations, ...project.moduleDeclarations],
    moduleInitialValues,
  );
  // 專案宣告的可攜 lookup 來源:之後 seed / reset / update 預檢同一份 registry 時也要認得
  registerAssembledLookupProviders(project.portableLookupProviders);
  const registry = composeSeedRegistry(
    [
      { origin: "base", seeds: base.seeds },
      {
        origin: "模組宣告推導",
        isDerived: true,
        seeds: [
          moduleSeeds.modules,
          moduleSeeds.permissions,
          moduleSeeds.dataScopeTargets,
          moduleSeeds.tenantAdminBindings,
        ],
      },
      { origin: "project", seeds: project.seeds },
    ],
    { lookupProviders: project.portableLookupProviders },
  );
  const violations = findSeedKeyViolations(registry);
  if (violations.length > 0) {
    throw new SeedCompositionError(violations);
  }
  return registry;
}

/** 目前有效的全部種子:seed 與 reset 指令都只讀這一份。 */
export const seedRegistry: SeedRegistry = assembleSeedRegistry(
  projectSeedSettings,
  projectSeedSource,
);

/**
 * demo 指令要灌的示範資料(專案登記;沒有登記為 null)。示範資料是業務資料,不進上面的 registry:
 * demo 指令以 api 建立示範機構後交給它(`src/demo/command.ts`)。
 */
export const demoSource: DemoSource | null = projectDemoSource;
