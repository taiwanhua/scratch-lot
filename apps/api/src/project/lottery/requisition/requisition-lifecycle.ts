import { Types } from "mongoose";

import {
  REQUISITION_FIELD_KEYS,
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
  referenceIdOf,
  requisitionLinesOf,
} from "@repo/domain/project/lottery";
import { GAME_STATUS } from "@repo/domain/project/lottery-master-data";

import { FormSubmissionsRepository } from "../../../database/base/repositories";
import {
  type FormGuardResult,
  registerFormLifecycle,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { REQUISITION_REASONS } from "./requisition-error";

function toObjectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

/**
 * 叫貨單的掛接點(專案規格 8 共通、8.1;正本 `docs/modules/project/purchasing.md`「叫貨單」):
 *
 * - `beforeSubmit`:明細至少一列本數大於 0;遊戲都要在、而且販售中(停售遊戲不能出現在新的叫貨單,規格 5.1)
 * - `completed`:寫叫貨明細副本 `lottery_requisition_lines`(分店 × 遊戲 × 本數;本數 0 的列不寫;重送不重複寫)
 * - `beforeVoid`:已被進貨單 / 調貨單引用的不能作廢(先作廢引用它的單,叫貨單就回到待購買)
 * - `voided`:副本補 `voidedAt`(不刪除)
 *
 * 草稿與審核中的單沒有副本,所以不進採購清單、不算在途(規格 8 共通「草稿」)。
 */
export const requisitionLifecycle = registerFormLifecycle({
  moduleKey: REQUISITION_MODULE_KEY,
  formKey: REQUISITION_FORM_KEY,
  inject: [
    FormSubmissionsRepository,
    LotteryGamesRepository,
    LotteryRequisitionLinesRepository,
  ],
  guards: {
    beforeSubmit: async ({
      operator,
      values,
      get,
    }): Promise<FormGuardResult> => {
      const lines = requisitionLinesOf(values);
      if (lines.length === 0) {
        return {
          code: REQUISITION_REASONS.noLines,
          message: "Requisition has no lines with books",
        };
      }
      const ids = lines
        .map((line) => toObjectId(line.gameId))
        .filter((id): id is Types.ObjectId => id !== null);
      const onSale = await get(LotteryGamesRepository).findMany(
        operator,
        { _id: { $in: ids }, status: GAME_STATUS.onSale },
        { select: "_id" },
      );
      return onSale.length === lines.length
        ? null
        : {
            code: REQUISITION_REASONS.gameDiscontinued,
            message: "Requisition has discontinued games",
          };
    },
    beforeVoid: async ({ operator, submission, get }) => {
      const referenced = await get(LotteryRequisitionLinesRepository).findOne(
        operator,
        { requisitionId: submission._id, referencedBy: { $ne: null } },
        { select: "_id" },
      );
      return referenced
        ? {
            code: REQUISITION_REASONS.referenced,
            message: "Requisition is referenced by a purchase or transfer",
          }
        : null;
    },
  },
  effects: {
    completed: async ({ operator, submissionId, session, get }) => {
      const repository = get(LotteryRequisitionLinesRepository);
      const existing = await repository.findOne(
        operator,
        { requisitionId: submissionId },
        { select: "_id", session },
      );
      if (existing) {
        return;
      }
      const submission = await get(FormSubmissionsRepository).findById(
        operator,
        submissionId,
      );
      if (!submission) {
        throw new Error(`叫貨單 ${String(submissionId)} 讀不到`);
      }
      const values = submission.values as Record<string, unknown>;
      const branchId = toObjectId(
        referenceIdOf(values[REQUISITION_FIELD_KEYS.branch]) ?? "",
      );
      if (branchId === null) {
        throw new Error(`叫貨單 ${String(submissionId)} 沒有叫貨分店`);
      }
      const completedAt = new Date();
      const rows = requisitionLinesOf(values).flatMap((line) => {
        const gameId = toObjectId(line.gameId);
        return gameId === null
          ? []
          : [
              {
                orgId: branchId,
                requisitionId: submissionId,
                serialNo: submission.serialNo,
                gameId,
                books: line.books,
                note: line.note,
                completedAt,
                voidedAt: null,
                referencedBy: null,
              },
            ];
      });
      await repository.createMany(operator, rows, { session });
    },
    voided: async ({ operator, submissionId, session, get }) => {
      await get(LotteryRequisitionLinesRepository).updateMany(
        operator,
        { requisitionId: submissionId, voidedAt: null },
        { $set: { voidedAt: new Date() } },
        { session },
      );
    },
  },
});
