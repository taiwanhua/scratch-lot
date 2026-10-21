import type { Types } from "mongoose";

import { isValidTimezone } from "@repo/domain/form";

import type { Persisted } from "../database/base.repository";
import type { OrgDocument } from "../database/database.module";
import { Org, OrgVisibility } from "./models/org.model";

/** 一筆讀回來的組織(含基礎欄位,ADR-0007)。 */
export type OrgRecord = Persisted<OrgDocument>;

/**
 * `orgs.settings.visibility` 的鍵與值(ADR-0005;未設視為 "own")。
 * DB 存小寫字串、對外是 `OrgVisibility` 列舉(GQL-01),轉換只在本檔。
 */
export const VISIBILITY_SETTING = "visibility";
const VISIBILITY_OWN = "own";
const VISIBILITY_SUBTREE = "subtree";

/** 租戶頂層 id(`ancestors` = [根, 租戶頂層, …];自己就是租戶頂層 / 根組織時回自己)。 */
export function tenantTopIdOf(org: OrgRecord): Types.ObjectId {
  return org.ancestors[1] ?? org._id;
}

/** 租戶頂層 = 根組織的直接子組織(`ancestors` 只有根組織一層);根組織與更下層都不是。 */
export function isTenantTop(org: OrgRecord): boolean {
  return org.ancestors.length === 1;
}

/** 可見範圍開關只掛在租戶頂層;其餘組織恆為 null(下層不看自己的,ADR-0005)。 */
export function visibilityOf(org: OrgRecord): OrgVisibility | null {
  if (!isTenantTop(org)) {
    return null;
  }
  return org.settings[VISIBILITY_SETTING] === VISIBILITY_SUBTREE
    ? OrgVisibility.SUBTREE
    : OrgVisibility.OWN;
}

/** `orgs.settings.timezone` 的鍵(租戶時區;讀取的正本是 `database/tenant-timezone.ts`)。 */
export const TIMEZONE_SETTING = "timezone";

/**
 * 時區只掛在**根組織**(根組織與它自己的資料)與**租戶頂層**(整個租戶);兩者以外的組織沒有自己的時區。
 */
export function hasOwnTimezone(org: OrgRecord): boolean {
  return org.parentId === null || isTenantTop(org);
}

/** 根組織 / 租戶頂層自己設的時區;其他組織、沒設或值不合法 → null(= 使用預設時區)。 */
export function timezoneOf(org: OrgRecord): string | null {
  if (!hasOwnTimezone(org)) {
    return null;
  }
  const timezone: unknown = org.settings[TIMEZONE_SETTING];
  return isValidTimezone(timezone) ? timezone : null;
}

/** 對外列舉 → DB 值。 */
export function visibilitySettingOf(visibility: OrgVisibility): string {
  return visibility === OrgVisibility.SUBTREE
    ? VISIBILITY_SUBTREE
    : VISIBILITY_OWN;
}

/** 組織文件 → GraphQL 的 `Org`(`logoUrl` 由 resolver 的 field resolver 現簽,ADR-0010)。 */
export function toOrg(org: OrgRecord): Org {
  return {
    id: String(org._id),
    name: org.name,
    // 根組織清空後存的是 null(初始 seed 值欄位,ADR-0002):與欄位不存在同樣對外回 null
    ...(org.description === undefined || org.description === null
      ? {}
      : { description: org.description }),
    parentId: org.parentId === null ? null : String(org.parentId),
    enabled: org.enabled,
    isSystem: org.isSystem,
    ownerUserId: org.ownerUserId === undefined ? null : String(org.ownerUserId),
    slug: org.slug ?? null,
    isDemo: org.isDemo === true,
    visibility: visibilityOf(org),
    timezone: timezoneOf(org),
    ...(org.logoPath === undefined ? {} : { logoPath: org.logoPath }),
  };
}
