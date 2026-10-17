import type { InjectionToken } from "@nestjs/common";

import type { ComposedDatabase } from "./registration";
import { DatabaseRegistrationError } from "./registration-error";

/**
 * 專案 lookup 來源清單的 DI token(`project/lookup-providers.ts` 的內容,由 `database.module.ts` 組裝提供)。
 * api 與受管定義 CLI 都匯入 `DatabaseModule`,所以兩邊拿到同一份清單。
 */
export const PROJECT_LOOKUP_SOURCES = Symbol("PROJECT_LOOKUP_SOURCES");

/** 這裡只看 repository 綁定;宣告的驗證在 `forms/lookup-provider-registration.ts`。 */
export interface LookupSourceRepositoryBinding {
  readonly declaration: { readonly key: string };
  readonly repositoryToken: InjectionToken;
}

function tokenLabel(token: InjectionToken): string {
  return typeof token === "function" ? token.name : String(token);
}

/**
 * 專案 lookup 來源只能綁**專案資料登記**的 repository:底座的 repository(如 `UsersRepository`)
 * 不經專案登記的碰撞與保護檢查,也不該被專案拿去對外開放查詢。不合就拋 `DatabaseRegistrationError`。
 */
export function assertLookupRepositories(
  sources: readonly LookupSourceRepositoryBinding[],
  composed: Pick<ComposedDatabase, "projectRepositories">,
): void {
  const projectTokens = new Set(
    composed.projectRepositories.map((binding) => binding.token),
  );
  for (const source of sources) {
    if (!projectTokens.has(source.repositoryToken)) {
      throw new DatabaseRegistrationError(
        `lookup 來源 ${source.declaration.key}:repository ${tokenLabel(source.repositoryToken)} 不是專案資料登記的 repository`,
      );
    }
  }
}
