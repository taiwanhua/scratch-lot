import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { isDocumentLock } from "@repo/domain/project/lottery";

import { FormSubmissionsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";

/** 張的鎖(只看來源)。 */
type LockRef = { refType: string; refId: Types.ObjectId } | null | undefined;

/**
 * 鎖住張的單據的單號(調貨中 / 批售中「哪一張單」;規格 7.4、21.5)。調貨單與批售單都是表單提交,鎖的 `refId`
 * 就是提交,單號讀 `serialNo`,不分表單;撤銷售出申請的鎖不查。`reader` 由呼叫端給(租戶邊界:單據可能在別家店)。
 */
@Injectable()
export class TicketLockDocuments {
  constructor(private readonly submissions: FormSubmissionsRepository) {}

  /** 單據 id → 單號(沒有單號的不回)。 */
  async serialsOf(
    reader: OperatorContext,
    locks: readonly LockRef[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        locks.flatMap((lock) =>
          lock != null && isDocumentLock(lock.refType)
            ? [String(lock.refId)]
            : [],
        ),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    const found = await this.submissions.findMany(
      reader,
      { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
      { select: "serialNo" },
    );
    return new Map(
      found.flatMap((row) =>
        row.serialNo == null ? [] : [[String(row._id), row.serialNo] as const],
      ),
    );
  }
}
