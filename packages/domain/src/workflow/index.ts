/**
 * `@repo/domain/workflow` 的出口檔(bunchee 由 `exports` 名反推本檔;GEN-01 的 packages 邊界例外)。
 * 審核流程引擎的純邏輯(Spec 6b §4–§6),前後端共用,不碰 Mongoose:
 *
 * - `types.ts`:StepDef / edges、實例 / StepState / 派任計畫 / 決定 / 歷程、任務與提交的 6b 形狀
 * - `graph.ts`:`startStepKey` / `endStepKey` / `nextStepKeys` / `previousStepKeys`
 * - `validate-definition.ts` / `validate-structure.ts` / `issues.ts`:定義檢查器(含結構檢查)
 * - `approver-audience.ts`:審核者來源「人員條件」的使用處選項與共用流程限制
 * - `form-refs.ts`、`submit-check.ts`:流程對表單欄位的引用檢查、送出時檢查
 * - `evaluate.ts`:`evaluateStep`(會簽模式的有效結果與 `late`)與全案終局選取
 * - `projection.ts`:任務投影規則(判斷表列 7)
 * - `plan.ts`:跳過條件求值、派任計畫(去重、剔除申請人、`taskKey`)
 * - `advance.ts`:`advance` 判斷表(給實例與任務 → 該做的動作清單)
 * - `managers.ts`:主管解析的純規則(從提交組織往上、上界租戶、剔除申請人)
 */
export * from "./advance";
export * from "./approver-audience";
export * from "./evaluate";
export * from "./form-refs";
export * from "./graph";
export * from "./issues";
export * from "./managers";
export * from "./plan";
export * from "./projection";
export * from "./submit-check";
export * from "./types";
export * from "./validate-definition";
