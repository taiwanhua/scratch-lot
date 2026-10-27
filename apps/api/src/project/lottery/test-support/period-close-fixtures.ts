import { type Connection, Types } from "mongoose";

import { LOTTERY_PERIOD_CLOSES_COLLECTION } from "../../database/lottery-accounts/lottery-period-close.schema";

/**
 * 直接寫一筆關帳紀錄(店面等功能測「不能選已關帳月份」用;關帳本身的檢查在 `period-close/period-close.test.ts`)。
 * `periodEnd` = 那個月的下月 1 日 00:00(租戶時區)。回傳撤銷的函式(刪掉這一筆,不影響其他情境)。
 */
export async function insertPeriodClose(
  connection: Connection,
  input: {
    tenantId: Types.ObjectId;
    month: string;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<() => Promise<void>> {
  const now = new Date();
  const collection = connection.collection(LOTTERY_PERIOD_CLOSES_COLLECTION);
  const { insertedId } = await collection.insertOne({
    orgId: input.tenantId,
    tenantId: input.tenantId,
    month: input.month,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    closedAt: now,
    closedBy: new Types.ObjectId(),
    note: null,
    snapshot: { bankAccounts: [], stores: [] },
    moduleKey: "accounts",
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });
  return async () => {
    await collection.deleteOne({ _id: insertedId });
  };
}
