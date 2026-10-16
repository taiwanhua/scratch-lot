import type { DataScopeRuleQuery, DataScopeTargetsQuery } from "@repo/graphql";

import type { RuleIssue } from "@/lib/base/data-scope-issues";
import type { DataScopeFieldLike } from "@/lib/base/data-scope-rule";
import type { OrgOption } from "@/lib/base/org-tree";

/** `dataScopeTargets` 的一個資料目標(左清單的一列、右編輯器的欄位目錄來源)。 */
export type DataScopeTarget =
  DataScopeTargetsQuery["dataScopeTargets"]["targets"][number];

/** 這個資料目標目前存著的規則(`dataScopeRule` 的 `rule`;`null` 代表尚無規則)。 */
export type DataScopeRuleData = NonNullable<
  DataScopeRuleQuery["dataScopeRule"]["rule"]
>;

/**
 * 條件值的使用者選項(使用者型別欄位的「值」下拉)。套用對象的候選由 AudiencePicker 自己查,
 * 不經過這裡。
 */
export interface PickerOption {
  id: string;
  /** 顯示字串「姓名(帳號)」 */
  label: string;
}

/**
 * 條件樹編輯器一路往下傳的**環境**:欄位目錄、各種值選擇器的選項、目前的問題標記。
 *
 * 條件列在樹的第四層(面板 → 規則 → 群組 → 條件列 → 值),逐項傳會變成大量穿透 props(REACT-05)。
 * 這裡把「整棵樹都要、而且不會因為改了某個節點而變」的東西收成一個唯讀物件當單一 prop 傳,
 * 不另外開 context(ADR-0012:context 只剩注入用)。
 */
export interface DataScopeEditorEnv {
  /** 該資料目標的欄位目錄(seed 宣告的業務欄位在前、基礎欄位殿後) */
  fields: readonly DataScopeFieldLike[];
  /** org 型別條件值用的扁平組織清單(label 是含祖先的路徑) */
  orgOptions: readonly OrgOption[];
  userOptions: readonly PickerOption[];
  /** 條件組合:`issueKey(ruleIndex, childPath, target)` → 問題;沒有問題的節點查不到 */
  issues: ReadonlyMap<string, RuleIssue>;
  /** 全部問題(套用對象的那幾個由 `audienceIssuesOf` 取出,交給 AudiencePicker) */
  ruleIssues: readonly RuleIssue[];
  /** 沒有 `system.data-scope.edit` 時整個編輯器唯讀 */
  isReadOnly: boolean;
}
