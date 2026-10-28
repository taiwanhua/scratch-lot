/**
 * data:行事曆特殊日的顏色改為必選、不能選灰色(規格 14.1;灰色是店休 / 不能排的顏色)。
 *
 * 這條規則之前存下的特殊日可能沒有顏色(`paletteKey` null / 缺席)或選了灰色:一次改成藍色(`blue`)。
 * 店休不動(一律存 null);已軟刪除的也一起改(恢復時同一條規則)。單一 `updateMany`,不逐筆寫。
 *
 * 冪等:改完就不在篩選條件裡,重跑什麼都不做。原本沒顏色 / 灰色的資料沒有留底,`down` 不做事。
 */

/** 特殊日可選的色票(與 `@repo/domain/project/tag-palette` 的 `SPECIAL_DAY_PALETTE_KEYS` 相同;遷移檔不 import 套件)。 */
const SPECIAL_DAY_PALETTE_KEYS = [
  "blue",
  "cyan",
  "green",
  "lime",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await db
    .collection("schedule_calendar_days")
    .updateMany(
      { type: "special", paletteKey: { $nin: SPECIAL_DAY_PALETTE_KEYS } },
      { $set: { paletteKey: "blue" } },
    );
};

export const down = async () => {};
