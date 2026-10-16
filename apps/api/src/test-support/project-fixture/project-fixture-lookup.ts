import type { FactoryProvider } from "@nestjs/common";

import {
  LOOKUP_PROVIDER,
  type LookupProviderRegistration,
} from "../../forms/lookup-provider-registration";
import { PROJECT_FIXTURE_MODULE_KEY } from "./database/project-fixture-item.schema";
import { ProjectFixtureItemsRepository } from "./database/project-fixture-items.repository";

/** 測試專案登記的 lookup 來源 key(`<專案前綴>_<名稱>`)。 */
export const PROJECT_FIXTURE_LOOKUP_KEY = "fixture_item";

/**
 * 測試專案的 lookup 來源(只存在於測試,不放正式 project 路徑):
 * 讀測試專案模組的資料表,要該模組的 `view`;執行面只給登記的 BaseRepository。
 */
export const PROJECT_FIXTURE_LOOKUP_PROVIDER: FactoryProvider<LookupProviderRegistration> =
  {
    provide: LOOKUP_PROVIDER,
    useFactory: (
      items: ProjectFixtureItemsRepository,
    ): LookupProviderRegistration => ({
      declaration: {
        key: PROJECT_FIXTURE_LOOKUP_KEY,
        name: "測試專案項目",
        permission: `${PROJECT_FIXTURE_MODULE_KEY}.view`,
        fields: {
          name: { type: "text", label: "名稱" },
          orgId: { type: "text", label: "組織" },
        },
        filterFields: [],
        labelField: "name",
      },
      runtime: { repository: items },
    }),
    inject: [ProjectFixtureItemsRepository],
  };
