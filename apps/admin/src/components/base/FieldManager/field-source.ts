import type { FieldOptionLike } from "./field-manager-types";

/**
 * 「來源」欄與「這一列能做什麼」集中在這裡(本頁唯一一處解讀 `ownerOrg` / `isOwn` 的地方)。
 *
 * 可見範圍的規則(全域 + 上層繼承 + 可見範圍內的下層;只能改自己這一層加的)由 **api** 算完,
 * 逐列給 `canEdit` / `canToggleEnabled`(正本 `docs/modules/field-manager.md`「api 介面」);
 * 前端只把它和「操作者有沒有這個權限」取交集,不自己推組織關係、也不推視角。
 */

/** 加這筆的組織;`null` = 全域種子(codegen 的可空欄位會是 `undefined`,在此歸一)。 */
const ownerOrgOf = (field: FieldOptionLike) => field.ownerOrg ?? null;

/** 種子選項(全域):沒有擁有組織 —— `label` / `order` / `description` 唯讀。 */
export const isSeedOption = (field: FieldOptionLike): boolean =>
  ownerOrgOf(field) === null;

/** 來源欄的文案 key、Tag 色調與組織名稱(`sourceOwn` 要帶組織名)。 */
export interface FieldSourceView {
  labelKey: "sourceGlobal" | "sourceOwn";
  tone: "grey" | "primary";
  /** 「<組織名稱> 自訂」的組織名;全域時為空字串。 */
  org: string;
}

/** 自己這一層加的才給主色 —— 上層 / 下層組織加的用灰色,和「改不動」的觀感一致。 */
export const fieldSourceView = (field: FieldOptionLike): FieldSourceView => {
  const owner = ownerOrgOf(field);
  return owner === null
    ? { labelKey: "sourceGlobal", tone: "grey", org: "" }
    : {
        labelKey: "sourceOwn",
        tone: field.isOwn ? "primary" : "grey",
        org: owner.name,
      };
};

/** 這一列的啟用開關能不能動 = 有權限 ∩ api 說這一筆可切。 */
export const canToggleOption = (
  field: FieldOptionLike,
  { canToggleEnabled }: { canToggleEnabled: boolean },
): boolean => canToggleEnabled && field.canToggleEnabled;

/** 這一列能不能編輯 = 有權限 ∩ api 說這一筆可編輯(種子與別層組織的一律不可)。 */
export const canEditOption = (
  field: FieldOptionLike,
  { canEdit }: { canEdit: boolean },
): boolean => canEdit && field.canEdit;

/**
 * 這一列的顏色能不能改 = 有 `edit` 權限 ∩ api 說這一筆可切(誰能改顏色同誰能停用 / 啟用:
 * 自訂選項限加它的那一層、全域選項限根組織)。
 */
export const canSetOptionColor = (
  field: FieldOptionLike,
  { canEdit }: { canEdit: boolean },
): boolean => canEdit && field.canToggleEnabled;

/**
 * 這一列動不了是因為「別的組織在管它」時,回那個組織的名稱(提示文案用);
 * 種子選項(由系統管理員維護)與自己加的回 null —— 那兩種各有自己的說法。
 */
export const managedByOrgOf = (field: FieldOptionLike): string | null => {
  const owner = ownerOrgOf(field);
  return owner !== null && !field.isOwn ? owner.name : null;
};
