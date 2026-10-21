import { Types } from "mongoose";

import { type StoredValues, sharedOrgIdsOf } from "@repo/domain/form";
import type { SubmissionStatus } from "@repo/domain/workflow";

import { sharedByFieldKeysOf } from "../../database/schemas/form.schema";

/**
 * 提交的 `sharedOrgIds`(依欄位共用,ADR-0014):表單設定 `sharedByFieldKeys` 指的組織引用欄,從這次要寫的存值取。
 * 引擎每次寫入存值(建草稿、存草稿、送出、修改、升級)都帶上同一次寫入;表單沒設 / 讀不到 = 空。
 * **草稿(`status = draft`,還沒送出過)一律空**:草稿只屬於建立者,不經共用給任何人看(專案直接讀表的服務也一樣);
 * 被退回 / 撤回的單已送出過,照常共用。
 * 不是 ObjectId 的值略過(存值已由引用欄的寫入規則驗過來源;別租戶的組織也命中不了,讀取分支釘 `tenantId`)。
 */
export function sharedOrgIdsFor(
  form: { sharedByFieldKeys?: readonly string[] | null } | null,
  values: StoredValues,
  status: SubmissionStatus,
): Types.ObjectId[] {
  if (form === null || status === "draft") {
    return [];
  }
  return sharedOrgIdsOf(sharedByFieldKeysOf(form), values).flatMap((id) =>
    Types.ObjectId.isValid(id) ? [new Types.ObjectId(id)] : [],
  );
}
