import type { LookupProviderRegistration } from "../../forms/lookup-provider-registration";
import { ProjectFixtureItemsRepository } from "./database/project-fixture-items.repository";
import { PROJECT_FIXTURE_PERMISSIONS } from "./fixtures";

/** 測試專案登記的 lookup 來源 key(前綴 = 資料表 `project_fixture_items` 的第一段)。 */
export const PROJECT_FIXTURE_LOOKUP_KEY = "project_fixture_item";
export const PROJECT_FIXTURE_CODE_LOOKUP_KEY = "project_fixture_code";

/**
 * 測試專案的 lookup 來源(只存在於測試;測試以它頂替 `project/lookup-providers.ts` 的內容):
 * 讀測試專案模組的資料表,要該模組的 `view`;`code` 受保護(要 `delete` 才讀得到);`enabled` 可當固定條件。
 */
export const PROJECT_FIXTURE_LOOKUP_PROVIDERS: readonly LookupProviderRegistration[] =
  [
    {
      declaration: {
        key: PROJECT_FIXTURE_LOOKUP_KEY,
        name: "測試專案項目",
        permission: PROJECT_FIXTURE_PERMISSIONS.view,
        fields: {
          name: { type: "text", label: "名稱" },
          code: {
            type: "text",
            label: "代碼",
            permission: PROJECT_FIXTURE_PERMISSIONS.delete,
          },
          orgId: { type: "text", label: "組織" },
          rank: { type: "number", label: "排序" },
        },
        filterFields: ["enabled"],
        labelField: "name",
        keywordFields: ["name", "code"],
      },
      repositoryToken: ProjectFixtureItemsRepository,
    },
    {
      // 關鍵字只比對受保護的 `code`:讀不到它的人打關鍵字 → 查無(不退回列全部)
      declaration: {
        key: PROJECT_FIXTURE_CODE_LOOKUP_KEY,
        name: "測試專案項目(依代碼)",
        permission: PROJECT_FIXTURE_PERMISSIONS.view,
        fields: {
          name: { type: "text" },
          code: {
            type: "text",
            permission: PROJECT_FIXTURE_PERMISSIONS.delete,
          },
        },
        filterFields: [],
        labelField: "name",
        keywordFields: ["code"],
      },
      repositoryToken: ProjectFixtureItemsRepository,
    },
  ];
