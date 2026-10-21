/**
 * data:受管表單的提交補上 `sharedOrgIds`(依欄位共用,ADR-0014;表單設定 `sharedByFieldKeys`)。
 *
 * 引擎在每次寫入存值時才算 `sharedOrgIds`;這個欄位出現之前送出的單沒有它,分店看不到總部建的單。
 * 這裡依受管表單這一版的宣告(`seeds/project/revisions/*` 的 `sharedByFieldKeys`,下表)從存值的組織引用欄
 * (`values.<欄位>.id`,存組織 id 字串)算一次:草稿一律空(草稿只屬於建立者)、取不到 / 不是 ObjectId 的略過、去重。
 * 不依賴表單設定本身(migration 在 registry 套用之前跑,表單此時可能還是舊版設定)。
 *
 * 冪等:只補還沒有 `sharedOrgIds` 的提交;重跑找不到要補的就什麼都不做。
 * 讀取端以缺席 = 不共用讀,`down` 不必移除,不做事。
 */

/** 受管表單 → 依欄位共用的組織引用欄(與各表單最新 revision 的 `sharedByFieldKeys` 相同)。 */
const SHARED_BY_FIELD_KEYS = {
  purchase: ["branch"],
  transfer: ["from_branch", "to_branch"],
  requisition: ["branch"],
  checkout_confirm: ["branch"],
  stocktake_confirm: ["branch"],
  sale_reversal: ["branch"],
  cash_correction: ["branch"],
  makeup_punch: ["branch"],
  support_request: ["branch"],
};

/** 一個組織引用欄的存值 → ObjectId(取不到 / 不是 ObjectId → null)。 */
function orgIdOf(key) {
  return {
    $convert: {
      input: `$values.${key}.id`,
      to: "objectId",
      onError: null,
      onNull: null,
    },
  };
}

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const submissions = db.collection("form_submissions");
  for (const [formKey, keys] of Object.entries(SHARED_BY_FIELD_KEYS)) {
    await submissions.updateMany(
      { formKey, status: "draft", sharedOrgIds: { $exists: false } },
      { $set: { sharedOrgIds: [] } },
    );
    await submissions.updateMany(
      { formKey, status: { $ne: "draft" }, sharedOrgIds: { $exists: false } },
      [
        {
          $set: {
            sharedOrgIds: {
              $setUnion: [
                {
                  $filter: {
                    input: keys.map((key) => orgIdOf(key)),
                    as: "orgId",
                    cond: { $ne: ["$$orgId", null] },
                  },
                },
                [],
              ],
            },
          },
        },
      ],
    );
  }
};

export const down = async () => {};
