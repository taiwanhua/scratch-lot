/**
 * 專案裡**允許呼叫搬家(`BaseRepository.reassignOrg`)的檔案**(相對 `apps/api/src/`;
 * 規則與底座清單見 `database/base.repository.ts` 的 `ORG_REASSIGN_CALLERS`)。
 * `database/exists-any-callers.test.ts` 合併兩份清單、以呼叫語法掃整個 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_ORG_REASSIGN_CALLERS: readonly string[] = [];
