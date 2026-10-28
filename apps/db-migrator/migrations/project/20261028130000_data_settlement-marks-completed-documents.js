/**
 * data:已完成的進貨單 / 調貨單補上結清標記(`lottery_settlement_marks`;正本 `docs/modules/project/accounts.md`「待結清款項」)。
 *
 * 待結清改成只掃還沒結清的:還沒完成的單據照狀態查,已完成的只算有待確認標記的(單據完成時建)。
 * 這個表出現之前完成的單據沒有標記,不補就不會出現在待結清。這裡替每一張已完成(沒軟刪除)的單據建一筆
 * 待確認的標記(`closedAsOf = null`);已經結清的,上線後第一次讀待結清時會算出來並寫上 `closedAsOf`,之後不再掃。
 * 單一 aggregate(`$merge`),不逐筆寫。先建 `refId` 唯一索引(`$merge` 的 `on` 要它;與 schema 宣告相同,api 啟動時不重建)。
 *
 * 冪等:已有標記的單據不動(`whenMatched: keepExisting`);重跑什麼都不做。
 * 讀取端沒有標記 = 不再掃那張已完成的單,`down` 移除標記會讓這些單據從待結清消失,所以不做事。
 */

/** 參與收付的單據(與 api `registerSettlementDocument` 的登記相同;遷移檔不 import 套件)。 */
const SETTLEMENT_MODULE_KEYS = ["purchasing.purchase", "purchasing.transfer"];

const MARKS = "lottery_settlement_marks";

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db.collection(MARKS).createIndex({ refId: 1 }, { unique: true });
  const now = new Date();
  await db
    .collection("form_submissions")
    .aggregate([
      {
        $match: {
          moduleKey: { $in: SETTLEMENT_MODULE_KEYS },
          status: "completed",
          deletedAt: null,
        },
      },
      {
        $project: {
          _id: 0,
          orgId: "$orgId",
          tenantId: "$tenantId",
          refType: "$moduleKey",
          refId: "$_id",
          closedAsOf: { $literal: null },
          rev: { $literal: 0 },
          moduleKey: { $literal: "accounts" },
          createdBy: { $literal: null },
          updatedBy: { $literal: null },
          deletedAt: { $literal: null },
          createdAt: { $literal: now },
          updatedAt: { $literal: now },
        },
      },
      {
        $merge: {
          into: MARKS,
          on: "refId",
          whenMatched: "keepExisting",
          whenNotMatched: "insert",
        },
      },
    ])
    .toArray();
};

export const down = async () => {};
