import type { DefinitionIssue } from "@repo/domain/form";

/**
 * 設計器顯示的檢查結果(domain 檢查器 `validateDefinition` 的錯誤 / 警告)。`code` 放寬成字串,
 * 保留 admin 自己加提醒的空間(只提醒、不擋發布,code 以 `ADMIN_` 開頭);目前沒有 admin 自己的警告。
 */
export interface DesignerIssue extends Omit<DefinitionIssue, "code"> {
  code: string;
}

export interface DesignerReport {
  errors: DesignerIssue[];
  warnings: DesignerIssue[];
}
