import type { DataScopeRuleQuery, DataScopeTargetsQuery } from "@repo/graphql";

import type { RuleIssue } from "@/lib/base/data-scope-issues";
import type { DataScopeFieldLike } from "@/lib/base/data-scope-rule";
import type { OrgNodeLike, OrgOption } from "@/lib/base/org-tree";

/** `dataScopeTargets` 的一個資料目標(左清單的一列、右編輯器的欄位目錄來源)。 */
export type DataScopeTarget =
  DataScopeTargetsQuery["dataScopeTargets"]["targets"][number];

/** 這個資料目標目前存著的規則(`dataScopeRule` 的 `rule`;`null` 代表尚無規則)。 */
export type DataScopeRuleData = NonNullable<
  DataScopeRuleQuery["dataScopeRule"]["rule"]
>;

/**
 * 套用對象與條件值共用的清單選項(角色 / 使用者)。
 * 角色的選項另外帶分辨同名角色用的欄位(#261 的 8;`lib/base/role-options.ts` 產生),
 * 使用者的選項只填 `id` / `label`。
 */
export interface PickerOption {
  id: string;
  /** 顯示字串;角色是「角色名稱 — 擁有組織」 */
  label: string;
  /** 角色名稱(搜尋用);使用者的選項不填 */
  name?: string;
  /** 擁有組織 id(分組用);使用者的選項不填 */
  ownerOrgId?: string | null;
  /** 擁有組織名稱(次文字 + 組標題);使用者的選項不填 */
  ownerOrgName?: string | null;
  /** 租戶頂層(角色管理頁的清單面板用同一份形狀;套用對象改以擁有組織分組,#372) */
  tenantTopId?: string | null;
  tenantTopName?: string | null;
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
  /** 套用對象「指定組織」用的組織樹 */
  orgNodes: readonly OrgNodeLike[];
  /** org 型別條件值用的扁平組織清單(label 是含祖先的路徑) */
  orgOptions: readonly OrgOption[];
  roleOptions: readonly PickerOption[];
  userOptions: readonly PickerOption[];
  /** `issueKey(ruleIndex, childPath, target)` → 問題;沒有問題的節點查不到 */
  issues: ReadonlyMap<string, RuleIssue>;
  /** 沒有 `system.data-scope.edit` 時整個編輯器唯讀 */
  isReadOnly: boolean;
}
