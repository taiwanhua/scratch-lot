/**
 * data:欄位選項的顏色改存在底座的選項本身(`fields.color`),專案表 `project_field_option_colors` 退場。
 *
 * 專案表一筆 = 一個選項(`fieldId`)的色票代號(`paletteKey`,null = 清掉過);設定的組織一律是選項的擁有者
 * (全域選項 = 根組織設、`tenantId` null;自訂選項 = 加它的那一層、`orgId` = 選項的 `orgId`)。
 * 搬法:
 *
 * - 只搬擁有者那一筆:全域選項(`fields.orgId` null)取 `tenantId` null 的那筆;自訂選項取 `orgId` 相同的那筆。
 *   不是擁有者設的(規則之外留下的)、已軟刪除的、選項已不存在的,一律不搬
 * - 代號照搬;認不得的代號(色票清單外)當成沒有顏色,寫 null
 * - 清掉過的(`paletteKey` null)也寫成 `color: null`:欄位存在 = 有人管過,之後 seed 的初始顏色不會蓋回去(ADR-0002)
 * - 只寫還沒有 `color` 欄位的選項:新版已經設過顏色的(欄位已存在)以新版為準
 * - 搬完刪掉專案表
 *
 * 冪等:搬過的選項已有 `color` 欄位、專案表也已刪,重跑什麼都不做;中途中斷時重跑會補完剩下的再刪表。
 * 色票代號照抄 `@repo/domain/tag-palette` 的 `TAG_PALETTE_KEYS`(遷移檔不 import 套件)。
 */

const SOURCE = "project_field_option_colors";

const TAG_PALETTE_KEYS = [
  "blue",
  "cyan",
  "green",
  "lime",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "grey",
];

const sameId = (left, right) =>
  left !== null &&
  left !== undefined &&
  right !== null &&
  right !== undefined &&
  String(left) === String(right);

/** 這一筆顏色是不是選項擁有者設的(全域選項看 `tenantId` null,自訂選項看 `orgId`)。 */
const isOwnerColor = (field, color) =>
  field.orgId === null || field.orgId === undefined
    ? color.tenantId === null || color.tenantId === undefined
    : sameId(field.orgId, color.orgId);

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const exists = await db.listCollections({ name: SOURCE }).hasNext();
  if (!exists) {
    return;
  }
  const colors = await db
    .collection(SOURCE)
    .find({ deletedAt: null })
    .toArray();
  const fields =
    colors.length === 0
      ? []
      : await db
          .collection("fields")
          .find(
            { _id: { $in: colors.map((color) => color.fieldId) } },
            { projection: { _id: 1, orgId: 1 } },
          )
          .toArray();
  const fieldById = new Map(fields.map((field) => [String(field._id), field]));

  const operations = [];
  for (const color of colors) {
    const field = fieldById.get(String(color.fieldId));
    if (field === undefined || !isOwnerColor(field, color)) {
      continue;
    }
    const value = TAG_PALETTE_KEYS.includes(color.paletteKey)
      ? color.paletteKey
      : null;
    operations.push({
      updateOne: {
        filter: { _id: field._id, color: { $exists: false } },
        update: { $set: { color: value } },
      },
    });
  }
  if (operations.length > 0) {
    await db.collection("fields").bulkWrite(operations, { ordered: false });
  }
  await db.collection(SOURCE).drop();
};

/**
 * 不重建專案表:顏色已經存在選項本身,退回舊版程式只是看不到顏色,不會壞資料;
 * 舊表的組織 / 租戶欄位也無法從選項正確還原(誰設的沒有留底)。
 *
 * @returns {Promise<void>}
 */
export const down = async () => {};
