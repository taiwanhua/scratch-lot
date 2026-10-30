import { localDayRange, parseLocalDate, toInstant } from "@repo/domain/form";
import type { FormSubmissionsQueryVariables } from "@repo/graphql";

import type { MockSubmission } from "./form-fixtures";

/** 假 api 的租戶時區(同假 `me.currentOrg.timezone`)。 */
const MOCK_TIMEZONE = "Asia/Taipei";

/** 摘要日期落在 `dateFrom`–`dateTo`(當地日期,含頭尾)內;兩邊都沒給 = 不篩、摘要沒日期 = 不列。 */
const matchesDateRange = (
  item: MockSubmission,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): boolean => {
  const from = parseLocalDate(dateFrom);
  const to = parseLocalDate(dateTo);
  if (from === null && to === null) {
    return true;
  }
  const instant = toInstant(item.summary?.date);
  if (instant === null) {
    return false;
  }
  return (
    (from === null ||
      instant >= localDayRange(from, from, MOCK_TIMEZONE).from) &&
    (to === null || instant < localDayRange(to, to, MOCK_TIMEZONE).to)
  );
};

/**
 * 假 api `formSubmissions` 的篩選(同 api 的 `FormSubmissionsService.list`):模組、表單、排除的表單、
 * 狀態、標題關鍵字、組織、日期區間。組織只比對同一個組織(假資料沒有組織樹,不展開下層)。
 */
export const matchesSubmissionsInput = (
  item: MockSubmission,
  input: FormSubmissionsQueryVariables["input"],
): boolean => {
  const keyword = input.keyword?.trim() ?? "";
  return (
    item.moduleKey === input.moduleKey &&
    (input.formKey == null || item.formKey === input.formKey) &&
    !(input.excludeFormKeys ?? []).includes(item.formKey) &&
    (input.status == null || item.status === input.status) &&
    (keyword === "" || (item.summary?.title ?? "").includes(keyword)) &&
    (input.orgId == null || item.orgId === input.orgId) &&
    matchesDateRange(item, input.dateFrom, input.dateTo)
  );
};
