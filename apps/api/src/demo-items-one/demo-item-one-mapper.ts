import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import type { DemoItemOneDocument } from "../database/database.module";
import {
  type PermissionHolding,
  holdsPermission,
} from "../permission/permission-resolver";
import type { DemoCategoryOptions } from "./demo-category.service";
import { validationError } from "./demo-items-one-error";
import {
  type DemoItemOneAbilities,
  type DemoItemOneModel,
  type DemoItemOneStatusEnum,
  type DemoItemOneUserRef,
} from "./models/demo-item-one.model";

export type DemoItemOneRecord = Persisted<DemoItemOneDocument>;

/** 模組 key 與權限 key(seed 正本 `apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`)。 */
export const SAMPLE_ONE_KEY = "demo.sub.sample-one";
export const SAMPLE_ONE_PERMISSIONS = {
  view: `${SAMPLE_ONE_KEY}.view`,
  create: `${SAMPLE_ONE_KEY}.create`,
  edit: `${SAMPLE_ONE_KEY}.edit`,
  delete: `${SAMPLE_ONE_KEY}.delete`,
  showInternalNote: `${SAMPLE_ONE_KEY}.show-internal-note`,
  editInternalNote: `${SAMPLE_ONE_KEY}.edit-internal-note`,
  showHistory: `${SAMPLE_ONE_KEY}.edit-page.show-history`,
} as const;

/** 審計動作名(模組文件「審計」節);`targetType` 一律 `demo_item_one`。 */
export const AUDIT_TARGET_TYPE = "demo_item_one";
export const AUDIT_ACTIONS = {
  create: "demo-item-one.create",
  edit: "demo-item-one.edit",
  delete: "demo-item-one.delete",
  toggleEnabled: "demo-item-one.toggle-enabled",
} as const;

/**
 * 稽核裡的內部備註一律以此取代內容(ADR-0004「不得放個資明文」的同一條):
 * 歷程只回「這個欄位有動過」,不回動了什麼 —— 否則沒有 `show-internal-note`
 * 卻有 `edit-page.show-history` 的人可以從歷程把它讀出來,投影就白做了。
 */
export const REDACTED = "[redacted]";

/** 一次算好的「這位操作者能做什麼」;每一列共用同一份(不逐列重算)。 */
export interface DemoItemOneViewContext {
  /** 持有 `show-internal-note`:false 時 `internalNote` 根本不放進回傳物件。 */
  canShowInternalNote: boolean;
  abilities: DemoItemOneAbilities;
  categories: DemoCategoryOptions;
  /** userId → 顯示名稱(建立者欄;一次查完,不逐列查)。 */
  users: ReadonlyMap<string, string>;
  /** 公開 bucket 的穩定 URL(`StorageService.publicUrlOf`,同步)。 */
  publicUrlOf: (objectPath: string | null | undefined) => string | null;
}

export function abilitiesOf(holding: PermissionHolding): DemoItemOneAbilities {
  return {
    canEdit: holdsPermission(holding, SAMPLE_ONE_PERMISSIONS.edit),
    canDelete: holdsPermission(holding, SAMPLE_ONE_PERMISSIONS.delete),
    canEditInternalNote: holdsPermission(
      holding,
      SAMPLE_ONE_PERMISSIONS.editInternalNote,
    ),
  };
}

export function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值。 */
export function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function userRefOf(
  id: Types.ObjectId | null,
  users: ReadonlyMap<string, string>,
): DemoItemOneUserRef | null {
  if (id === null) {
    return null;
  }
  const name = users.get(String(id));
  return name === undefined ? null : { id: String(id), name };
}

/**
 * 一筆資料的對外形狀。
 *
 * **`internalNote` 的「欄位缺席」**:沒有 `show-internal-note` 時**不把這個鍵放進物件**,
 * GraphQL 因此序列化成 `null` —— 值不經過任何一段序列化路徑,也不會被 log 帶出去。
 * 前端依自己的權限集決定要不要渲染這個欄位(模組文件「api 介面」節寫明)。
 */
export function toDemoItemOneModel(
  record: DemoItemOneRecord,
  context: DemoItemOneViewContext,
): DemoItemOneModel {
  const attachmentPath = record.attachmentPath ?? null;
  return {
    id: String(record._id),
    name: record.name,
    category: record.category ?? null,
    categoryLabel:
      record.category === undefined
        ? null
        : (context.categories.get(record.category) ?? null),
    note: record.note ?? null,
    ...(context.canShowInternalNote
      ? { internalNote: record.internalNote ?? null }
      : {}),
    coverPath: record.coverPath ?? null,
    coverUrl: context.publicUrlOf(record.coverPath),
    // 中繼資料原樣回;早期的附件沒有這三欄 → null,前端退回顯示路徑尾段
    attachment:
      attachmentPath === null
        ? null
        : {
            path: attachmentPath,
            name: record.attachmentName ?? null,
            size: record.attachmentSize ?? null,
            contentType: record.attachmentContentType ?? null,
          },
    status: record.status as DemoItemOneStatusEnum,
    enabled: record.enabled,
    createdBy: userRefOf(record.createdBy, context.users),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    abilities: context.abilities,
  };
}
