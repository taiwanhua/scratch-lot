import { demoItemsOne, demoItemsTwo } from "./demo-items";
import { fieldCategories } from "./field-categories";
import { fields } from "./fields";
import { baseModuleDeclarations } from "./modules";
import { rootOrgSeed } from "./orgs";
import { roleOwners, roles } from "./roles";
import { rootAdmin } from "./root-admin";
import {
  type ProjectSeedSettings,
  type SeedSource,
  assertProjectSeedSettings,
} from "./seed-source";

/**
 * 底座的種子來源(正本:ADR-0002)。新增一類底座種子 = 新增一個宣告檔並在此登記。
 *
 * 專案的初值由固定組裝入口(`seeds/registry.ts`)讀進來再傳入;本檔不 import `seeds/project/`。
 * 模組宣告交給組裝入口與專案的合併後一次推導(modules / permissions / 資料範圍目標 / 租戶管理員模板),
 * 所以這裡的 `seeds` 不含那四類。登記順序只影響摘要的列印順序:實際執行順序由組裝時依引用排定
 * (組織 → 角色 → 角色擁有組織 → root 初始帳號 → 欄位類別 → 欄位選項 → 示範資料)。
 */
export function createBaseSeedRegistry(
  settings: ProjectSeedSettings,
): SeedSource {
  const { rootOrg } = assertProjectSeedSettings(settings);
  return {
    moduleDeclarations: baseModuleDeclarations,
    seeds: [
      rootOrgSeed(rootOrg),
      roles,
      roleOwners,
      rootAdmin,
      fieldCategories,
      fields,
      // 示範資料:orgId 引用組織、category 值對照欄位選項
      demoItemsOne,
      demoItemsTwo,
    ],
  };
}
