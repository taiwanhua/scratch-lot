import type { Types } from "mongoose";

import type { OperatorContext } from "../../database/operator-context";

/*
 * 密碼流程觸及的表(users、action_tokens、refresh_tokens)都屬帳號、不是租戶資料,不受租戶過濾;
 * 這兩個上下文只決定基礎欄位的 createdBy / updatedBy(與 auth.service.ts 內同名的私有工具語意相同)。
 */

/** 以該使用者為操作者寫入(createdBy / updatedBy = 本人)。 */
export function asAccount(userId: Types.ObjectId): OperatorContext {
  return {
    actorId: userId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    // 密碼流程走不到資料範圍規則(ADR-0008);明寫空集合而非省略
    memberOrgIds: [],
    roleIds: [],
  };
}

/** 尚未知道操作者是誰時的查詢用上下文(以 email / token 雜湊定位帳號)。 */
export const LOOKUP: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
};
