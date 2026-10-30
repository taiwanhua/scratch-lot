/**
 * cleanup:共用宣告是「預設不共用、清單固定」的專案表,拿掉永遠是空的 `shareOrgs` 與它的索引(ADR-0014)。
 *
 * 這三張表只靠 `sharedByFields` 共用(點收紀錄的調出店、班表人員的所屬分店、彩券本的持有組織),
 * 清單永遠是 `[]`;`tenantScopePlugin` 對這種宣告不再宣告 `shareOrgs` 欄位與 `{ tenantId, "shareOrgs.orgId" }`
 * 索引,讀取也不再加共用清單的分支。這裡把既有資料的空清單與舊索引一起清掉(mongoose 不會自己刪索引)。
 *
 * 只 `$unset` 空清單:萬一有非空的(資料損毀),留著不動、讀取端本來就不看它。
 * 冪等:索引先查再刪(名稱由 mongoose 產,依鍵判斷);重跑時找不到要清的就什麼都不做。
 */

const COLLECTIONS = [
  "lottery_transfer_receipts",
  "schedule_staff",
  "lottery_books",
];
const SHARE_ORGS_INDEX_KEY = { tenantId: 1, "shareOrgs.orgId": 1 };

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const target = JSON.stringify(SHARE_ORGS_INDEX_KEY);
  for (const name of COLLECTIONS) {
    const collection = db.collection(name);
    const indexes = await collection.indexes().catch(() => []);
    for (const index of indexes) {
      if (JSON.stringify(index.key) === target && index.name) {
        await collection.dropIndex(index.name);
      }
    }
    await collection.updateMany(
      { shareOrgs: { $size: 0 } },
      { $unset: { shareOrgs: "" } },
    );
  }
};

/**
 * 不退回:缺席與空清單在讀取端等價,舊版程式啟動時會自己重建索引。
 *
 * @returns {Promise<void>}
 */
export const down = async () => {};
