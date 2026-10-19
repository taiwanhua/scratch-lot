import { GraphQLError } from "graphql";

/**
 * 示範模組1(`demo.sub.sample-one`)的錯誤。
 *
 * **不新增 code**:沿用 GQL-04 的通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`;
 * 分歧的「為什麼」一律以 `extensions.reason` 表示(GQL-04「同一個 code 有多種說法時加 reason」)。
 * message 給開發者看(英文);使用者文案由前端依 code / reason 對應。
 */

/**
 * `FORBIDDEN` 的 `extensions.reason`(規則正本 `docs/modules/demo.sub.sample-one.md`)。
 * 光看 `FORBIDDEN` 分不出是「整個端點沒權限」(由 `@RequirePermission` 擋下、無 reason)
 * 還是「端點可以用,但你硬送了一個你不能寫的欄位」。
 */
export const DEMO_ITEM_ONE_FORBIDDEN_REASONS = [
  /**
   * 欄位級權限(ADR-0004,綁父模組):沒有 `demo.sub.sample-one.edit-internal-note`
   * 卻在 create / update 的 input 裡送了 `internalNote`(含送 `null` 要清空)。
   * 前端正常流程不會送(欄位唯讀 / 缺席),硬送即拒 —— 投影排除不等於寫入被擋,兩件事各守一層。
   */
  "FIELD_FORBIDDEN",
] as const;

export type DemoItemOneForbiddenReason =
  (typeof DEMO_ITEM_ONE_FORBIDDEN_REASONS)[number];

/** 有登入但做了不被允許的事(GQL-04 `FORBIDDEN`);附 reason 讓前端講得出是哪一種。 */
export function forbiddenError(
  message: string,
  reason: DemoItemOneForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}

/** 查的資料在操作者**可見範圍 + 資料範圍規則**之內不存在(GQL-04 `NOT_FOUND`)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/**
 * 輸入不合法(GQL-04 `VALIDATION_FAILED`):`extensions.fields` 列出有問題的欄位,
 * 前端據此把錯誤標在對應的表單欄位上(如空白名稱、不在合併範圍內的分類)。
 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}
