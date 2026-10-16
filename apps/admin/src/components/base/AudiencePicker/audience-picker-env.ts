import type { AudienceField } from "@repo/domain/audience";

import type {
  AudienceIssueTarget,
  AudienceOrgSourceOption,
} from "@/lib/base/audience-draft";

import type { AudienceOptions } from "./useAudienceOptions";

/**
 * 條件樹一路往下傳的**環境**:可用欄位、組織來源、候選清單、錯誤查詢。
 * 條件列在第四層(Picker → 群組 → 條件列 → 值),逐項傳會變成大量穿透 props(REACT-05),
 * 收成一個唯讀物件當單一 prop 傳(同資料範圍編輯器的 `DataScopeEditorEnv`)。
 */
export interface AudiencePickerEnv {
  fields: readonly AudienceField[];
  orgSources: readonly AudienceOrgSourceOption[];
  options: AudienceOptions;
  /** 某一格的錯誤文字;沒有錯誤回 `undefined` */
  issueOf: (
    childPath: readonly number[],
    target: AudienceIssueTarget,
  ) => string | undefined;
  isReadOnly: boolean;
}
