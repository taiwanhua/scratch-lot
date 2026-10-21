/**
 * 專案裡**允許呼叫搬家(`BaseRepository.reassignOrg`)的檔案**(相對 `apps/api/src/`;
 * 規則與底座清單見 `database/base.repository.ts` 的 `ORG_REASSIGN_CALLERS`)。
 * `database/exists-any-callers.test.ts` 合併兩份清單、以呼叫語法掃整個 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_ORG_REASSIGN_CALLERS: readonly string[] = [
  // 張換店(調入、尋回到刷到的那家店)、整本調貨時本跟著換店
  "project/lottery/tickets/ticket-ledger.service.ts",
  // 打卡改對應到別家店的排班:卡的分店跟著排班(出勤紀錄的 [改對應排班])
  "project/schedule/attendance/punch-ledger.ts",
];
