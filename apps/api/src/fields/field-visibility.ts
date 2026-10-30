import { Types } from "mongoose";

import { type TagPaletteKey, isTagPaletteKey } from "@repo/domain/tag-palette";

import type { Persisted } from "../database/base.repository";
import type {
  FieldDocument,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { FieldModel } from "./models/field.model";

type FieldRecord = Persisted<FieldDocument>;

/** 全域種子的排序深度:排在所有組織之前(它是每個人共同的最上層)。 */
const GLOBAL_DEPTH = -1;

/**
 * 欄位選項的「看得到什麼、改得動什麼」(規則表正本 `docs/modules/field-manager.md`):
 *
 * **看得到** = 全域 + 我的上層(一路到租戶頂層,**不受可見性開關影響**)+ 自己
 * + 我可見範圍內的下層;**只能編輯 / 停用自己這一層加的**。
 *
 * 「上層不受可見性開關影響」是這個檔存在的原因:祖先組織不在 `visibleOrgIds` 裡,
 * 掛在 `fields` 上的 `tenantScopePlugin` 會把它們的選項濾掉,所以讀取要改用
 * `fieldReadContext`(範圍提升)+ 明列 orgId 的條件(範圍由本檔算)。
 */
export interface FieldVisibility {
  /** 當前組織:自訂選項「是不是我這一層加的」以它判定(ADR-0005)。 */
  currentOrgId: Types.ObjectId | null;
  /** 合併清單吃的 orgId 集合(含 null = 全域);`"all"` = 不限,根組織看得到全部租戶的。 */
  scopeOrgIds: (Types.ObjectId | null)[] | "all";
  /** 上層繼承鏈 = 全域 + 祖先 + 自己;`value` 不可與這條鏈上任一筆重複(見 `FIELD_VALUE_DUPLICATE`)。 */
  inheritedOrgIds: (Types.ObjectId | null)[];
  /** 站在根組織(可見範圍 = 全部):種子選項的**全域** enabled 開關只有這種操作者切得動。 */
  isRoot: boolean;
}

/** 來源欄要用的組織資料;`depth` = `ancestors` 長度,合併清單的次要排序鍵。 */
export interface OwnerOrgInfo {
  id: string;
  name: string;
  depth: number;
}

export type OwnerOrgs = ReadonlyMap<string, OwnerOrgInfo>;

/**
 * 讀取「上層繼承」相關資料時用的上下文:兩個範圍暫時提升為 `"all"`
 * (先例:`orgs/orgs.service.ts` 的 `subtreeContext`)。
 *
 * **只准搭配把查詢釘死在明列 id 上的條件**:`fields` 一律配 `scopeFilterOf` /
 * `inheritedOrgIds`,`orgs` 一律配當前組織自己的 `_id` 或合併清單裡出現過的 orgId。
 * 範圍本身仍由本檔依規則表算出來,提升的只是「資料層不要再濾一次」。
 */
export function fieldReadContext(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/** 去重(null 只留一筆);順序不影響查詢,但讓測試與 log 穩定。 */
function uniqueOrgIds(
  ids: (Types.ObjectId | null)[],
): (Types.ObjectId | null)[] {
  const seen = new Set<string>();
  const result: (Types.ObjectId | null)[] = [];
  for (const id of ids) {
    const key = id === null ? "null" : String(id);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(id);
    }
  }
  return result;
}

/** 依操作者算出可見範圍與繼承鏈;祖先由當前組織的 `orgs.ancestors` 取(物化路徑,ADR-0005)。 */
export async function resolveFieldVisibility(
  operator: OperatorContext,
  orgs: OrgsRepository,
): Promise<FieldVisibility> {
  const { currentOrgId } = operator;
  const isRoot = operator.visibleOrgIds === "all";
  if (currentOrgId === null) {
    // 沒有當前組織(非登入線的內部上下文):只看得到全域,什麼都不擁有
    return {
      currentOrgId,
      scopeOrgIds: isRoot ? "all" : [null],
      inheritedOrgIds: [null],
      isRoot,
    };
  }
  const current = await orgs.findById(fieldReadContext(operator), currentOrgId);
  const inheritedOrgIds = uniqueOrgIds([
    null,
    ...(current?.ancestors ?? []),
    currentOrgId,
  ]);
  if (operator.visibleOrgIds === "all") {
    return { currentOrgId, scopeOrgIds: "all", inheritedOrgIds, isRoot };
  }
  return {
    currentOrgId,
    scopeOrgIds: uniqueOrgIds([...inheritedOrgIds, ...operator.visibleOrgIds]),
    inheritedOrgIds,
    isRoot,
  };
}

/** 合併清單與單筆查詢共用的 orgId 條件;根組織不加條件(看得到全部租戶的)。 */
export function scopeFilterOf(visibility: FieldVisibility): {
  orgId?: { $in: (Types.ObjectId | null)[] };
} {
  return visibility.scopeOrgIds === "all"
    ? {}
    : { orgId: { $in: visibility.scopeOrgIds } };
}

/**
 * 取合併清單裡出現過的組織的名稱與深度(來源欄 + 次要排序鍵)。
 * 一次查完、不逐列查(N+1);查詢釘死在這些 orgId 上,見 `fieldReadContext`。
 */
export async function loadOwnerOrgs(
  operator: OperatorContext,
  orgs: OrgsRepository,
  fields: readonly FieldRecord[],
): Promise<OwnerOrgs> {
  const ids = [
    ...new Set(
      fields
        .filter((field) => field.orgId !== null)
        .map((field) => String(field.orgId)),
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const found = await orgs.findMany(fieldReadContext(operator), {
    _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
  });
  return new Map(
    found.map((org) => [
      String(org._id),
      { id: String(org._id), name: org.name, depth: org.ancestors.length },
    ]),
  );
}

/** 全域種子:`orgId` 為 null(`isSystem` 一併看,避免有 orgId 的資料被當成種子)。 */
function isSeed(field: FieldRecord): boolean {
  return field.orgId === null || field.isSystem;
}

/** 這一筆是不是**當前組織**這一層加的(= 可編輯 / 可停用的唯一條件)。 */
function isOwnedByCurrentOrg(
  field: FieldRecord,
  visibility: FieldVisibility,
): boolean {
  return (
    field.orgId !== null &&
    visibility.currentOrgId !== null &&
    String(field.orgId) === String(visibility.currentOrgId)
  );
}

export function canEditField(
  field: FieldRecord,
  visibility: FieldVisibility,
): boolean {
  return !isSeed(field) && isOwnedByCurrentOrg(field, visibility);
}

export function canToggleFieldEnabled(
  field: FieldRecord,
  visibility: FieldVisibility,
): boolean {
  return isSeed(field)
    ? visibility.isRoot
    : isOwnedByCurrentOrg(field, visibility);
}

/** 合併清單的排序:先 `order`,同 `order` 再依組織深度(全域最前、下層最後)。 */
export function compareFields(
  left: FieldRecord,
  right: FieldRecord,
  owners: OwnerOrgs,
): number {
  return (
    left.order - right.order || depthOf(left, owners) - depthOf(right, owners)
  );
}

function depthOf(field: FieldRecord, owners: OwnerOrgs): number {
  if (field.orgId === null) {
    return GLOBAL_DEPTH;
  }
  return owners.get(String(field.orgId))?.depth ?? 0;
}

/**
 * 一筆選項的對外形狀:`ownerOrg` / `isOwn` / `canEdit` / `canToggleEnabled`
 * 全由 api 依操作者算好,前端只讀不再自己推(GQL-07;原本的 `isRootPerspective` 近似法退場)。
 */
export function toFieldModel(
  field: FieldRecord,
  visibility: FieldVisibility,
  owners: OwnerOrgs,
): FieldModel {
  return {
    id: String(field._id),
    categoryId: String(field.categoryId),
    label: field.label,
    value: field.value,
    order: field.order,
    enabled: field.enabled,
    description: field.description ?? null,
    color: colorOf(field),
    ownerOrg: ownerOrgOf(field, owners),
    isOwn: isOwnedByCurrentOrg(field, visibility),
    canEdit: canEditField(field, visibility),
    canToggleEnabled: canToggleFieldEnabled(field, visibility),
  };
}

/** 選項的色票代號;沒設或認不得的代號(色票改版前的舊資料)一律當沒有顏色。 */
export function colorOf(
  field: Pick<FieldRecord, "color">,
): TagPaletteKey | null {
  return isTagPaletteKey(field.color) ? field.color : null;
}

/**
 * 全域種子回 null;自訂選項回擁有它的組織。
 * 查不到組織文件(組織已被軟刪除)時仍回 id、名稱留空 —— 不可退回 null,
 * 那會讓它在畫面上偽裝成全域選項。
 */
function ownerOrgOf(
  field: FieldRecord,
  owners: OwnerOrgs,
): FieldModel["ownerOrg"] {
  if (field.orgId === null) {
    return null;
  }
  const id = String(field.orgId);
  return { id, name: owners.get(id)?.name ?? "" };
}
