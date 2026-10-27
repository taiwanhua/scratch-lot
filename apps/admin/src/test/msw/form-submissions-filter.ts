import type { FormSubmissionsQueryVariables } from "@repo/graphql";

import type { MockSubmission } from "./form-fixtures";

/**
 * 假 api `formSubmissions` 的篩選(同 api 的 `FormSubmissionsService.list`):模組、表單、排除的表單、
 * 狀態、標題關鍵字。
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
    (keyword === "" || (item.summary?.title ?? "").includes(keyword))
  );
};
