/**
 * schema:調貨點收紀錄改成「一次點收一筆」(選張的列逐張點收,專案規格 8.4),一列可以有好幾筆。
 *
 * 拿掉 `lottery_transfer_receipts` 舊的 `(submissionId, rowId)` 唯一索引(一列只能點收一次),
 * 換成同鍵的一般索引(api 讀一張單的點收紀錄用)。舊資料不用轉:一列一筆就是「一次點收整列」。
 *
 * 冪等:先查再刪 / 建(名稱由 mongoose 產,不寫死;依鍵與 unique 判斷)。
 */

const COLLECTION = "lottery_transfer_receipts";
const KEY = { submissionId: 1, rowId: 1 };

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collection = db.collection(COLLECTION);
  const indexes = await collection.indexes().catch(() => []);
  const target = JSON.stringify(KEY);
  for (const index of indexes) {
    if (
      JSON.stringify(index.key) === target &&
      index.unique === true &&
      index.name
    ) {
      await collection.dropIndex(index.name);
    }
  }
  await collection.createIndex(KEY);
};

/**
 * 不退回唯一索引:逐張點收之後一列可能已有好幾筆,重建唯一索引一定失敗,而且沒有正確的合併方式。
 *
 * @returns {Promise<void>}
 */
export const down = async () => {};
