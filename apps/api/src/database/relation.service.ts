/* eslint-disable @repo/no-raw-model-query -- 此檔即核心關聯的唯一合法出口(ADR-0001):core_relationships 只能經 RelationService 的具名包裝存取;到期條件:無 */
import type { Model, Types } from "mongoose";

import type { OperatorContext } from "./operator-context";
import type { BaseFields } from "./plugins/base-fields.plugin";
import type {
  CoreRelationship,
  CoreRelationshipType,
} from "./schemas/core-relationship.schema";

/** 一筆核心關聯的內容(命名順序 Org > User > Role > Module > Permission,ADR-0001)。 */
export interface RelationLink {
  type: CoreRelationshipType;
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
  /** 關聯自身資訊(授權人、時間等)。 */
  meta?: Record<string, unknown>;
}

/** MongoDB 唯一索引衝突的錯誤碼。 */
const DUPLICATE_KEY_CODE = 11_000;

/**
 * 關聯寫入被唯一索引拒絕(ADR-0001 防重):同一組關聯已存在,
 * 或 `org_role` 的角色已有擁有組織(一個角色僅一個擁有組織)。
 */
export class DuplicateRelationError extends Error {
  override name = "DuplicateRelationError";
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_CODE
  );
}

interface BulkWriteFailure {
  index: number;
  code: number;
}

interface RawWriteError {
  index?: number;
  code?: number;
  err?: { index?: number; code?: number };
}

/** 從 `insertMany({ ordered: false })` 的錯誤取出逐筆失敗清單;不是批次寫入錯誤回 undefined。 */
function bulkWriteFailuresOf(error: unknown): BulkWriteFailure[] | undefined {
  const writeErrors =
    typeof error === "object" && error !== null
      ? (error as { writeErrors?: unknown }).writeErrors
      : undefined;
  if (!Array.isArray(writeErrors)) {
    return undefined;
  }
  // driver 的 WriteError:index / code 是 getter,原始資料在 .err;兩處都看,不依賴其中一種形狀
  return writeErrors.map((writeError: RawWriteError) => ({
    index: writeError.index ?? writeError.err?.index ?? -1,
    code: writeError.code ?? writeError.err?.code ?? -1,
  }));
}

/** 已落庫的一筆核心關聯(含基礎欄位,ADR-0007)。 */
export type RelationRecord = CoreRelationship &
  BaseFields & { _id: Types.ObjectId };

/** 使用者的一筆所屬組織(org_user)與加入時間。 */
export interface OrgMembership {
  orgId: Types.ObjectId;
  joinedAt: Date;
}

/** `ensureLinks` 的結果:與 seed 摘要同一套詞彙(新增 / 未變)。 */
export interface EnsureLinksResult {
  created: number;
  unchanged: number;
}

/**
 * 核心關聯(ADR-0001)的唯一出口:五種 relationType 各有具名包裝(讀/寫),
 * 底下共用批次寫入原語。核心關聯不受租戶過濾(歸屬由兩端實體決定),
 * 讀取不需操作者上下文;寫入以操作者上下文填 createdBy / updatedBy(ADR-0007)。
 */
export class RelationService {
  constructor(private readonly model: Model<CoreRelationship>) {}

  // ---- org_user:所屬組織(ADR-0003) ----

  /** 把使用者加入組織(`org_user`:first = org、second = user)。 */
  addUserToOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.linkMany(operator, [
      { type: "org_user", firstId: orgId, secondId: userId, meta },
    ]);
  }

  /** 從組織移除使用者;不自動解除任何角色授予(ADR-0003,解除由呼叫端依操作者選擇另行處理)。 */
  async removeUserFromOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    await this.unlinkMany(operator, [
      { type: "org_user", firstId: orgId, secondId: userId },
    ]);
  }

  /** 使用者的所屬組織 id(可見範圍計算的原料,ADR-0005)。 */
  listOrgIdsOfUser(userId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.firstIdsOf("org_user", [userId]);
  }

  /**
   * 使用者的所屬組織,依加入時間(關聯建立時間)由早到晚 —
   * 登入時的預設當前組織 = 第一個;與 `listOrgIdsOfUser` 的差別只在保證順序。
   */
  async listOrgMembershipsOfUser(
    userId: Types.ObjectId,
  ): Promise<OrgMembership[]> {
    const links = await this.model
      .find({ type: "org_user", secondId: userId })
      .sort({ createdAt: 1, _id: 1 })
      .lean<RelationRecord[]>()
      .exec();
    return links.map((link) => ({
      orgId: link.firstId,
      joinedAt: link.createdAt,
    }));
  }

  /** 某組織的成員(使用者)id。 */
  listUserIdsOfOrg(orgId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.secondIdsOf("org_user", [orgId]);
  }

  // ---- org_role:擁有組織(ADR-0003;一個角色僅一個擁有組織) ----

  /** 設定角色的擁有組織(`org_role`:first = org、second = role);角色已有擁有組織則拒絕。 */
  setRoleOwnerOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    roleId: Types.ObjectId,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.linkMany(operator, [
      { type: "org_role", firstId: orgId, secondId: roleId, meta },
    ]);
  }

  /** 角色的擁有組織 id;未設定回 null。 */
  async findOwnerOrgIdOfRole(
    roleId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const [orgId] = await this.firstIdsOf("org_role", [roleId]);
    return orgId ?? null;
  }

  /** 某組織擁有的角色 id。 */
  listRoleIdsOfOrg(orgId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.secondIdsOf("org_role", [orgId]);
  }

  // ---- user_role:角色授予(ADR-0003) ----

  /** 把角色授予使用者(`user_role`:first = user、second = role)。 */
  assignRoleToUser(
    operator: OperatorContext,
    userId: Types.ObjectId,
    roleId: Types.ObjectId,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.linkMany(operator, [
      { type: "user_role", firstId: userId, secondId: roleId, meta },
    ]);
  }

  /** 解除使用者的一筆角色授予。 */
  async revokeRoleFromUser(
    operator: OperatorContext,
    userId: Types.ObjectId,
    roleId: Types.ObjectId,
  ): Promise<void> {
    await this.unlinkMany(operator, [
      { type: "user_role", firstId: userId, secondId: roleId },
    ]);
  }

  /** 使用者持有的角色 id。 */
  listRoleIdsOfUser(userId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.secondIdsOf("user_role", [userId]);
  }

  /** 被授予某角色的使用者 id(角色側「分配使用者」分頁)。 */
  listUserIdsOfRole(roleId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.firstIdsOf("user_role", [roleId]);
  }

  // ---- role_module:角色綁模組 = 可進入的頁面(ADR-0004 / ADR-0011) ----

  /** 角色綁模組(`role_module`:first = role、second = module)。 */
  bindModuleToRole(
    operator: OperatorContext,
    roleId: Types.ObjectId,
    moduleId: Types.ObjectId,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.linkMany(operator, [
      { type: "role_module", firstId: roleId, secondId: moduleId, meta },
    ]);
  }

  /** 解除角色的一筆模組綁定。 */
  async unbindModuleFromRole(
    operator: OperatorContext,
    roleId: Types.ObjectId,
    moduleId: Types.ObjectId,
  ): Promise<void> {
    await this.unlinkMany(operator, [
      { type: "role_module", firstId: roleId, secondId: moduleId },
    ]);
  }

  /** 多個角色綁定的模組 id 聯集(ADR-0011 步驟 3)。 */
  listModuleIdsOfRoles(roleIds: Types.ObjectId[]): Promise<Types.ObjectId[]> {
    return this.secondIdsOf("role_module", roleIds);
  }

  // ---- role_permission:角色綁權限(ADR-0004 / ADR-0011) ----

  /** 角色綁權限(`role_permission`:first = role、second = permission)。 */
  bindPermissionToRole(
    operator: OperatorContext,
    roleId: Types.ObjectId,
    permissionId: Types.ObjectId,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.linkMany(operator, [
      {
        type: "role_permission",
        firstId: roleId,
        secondId: permissionId,
        meta,
      },
    ]);
  }

  /** 解除角色的一筆權限綁定。 */
  async unbindPermissionFromRole(
    operator: OperatorContext,
    roleId: Types.ObjectId,
    permissionId: Types.ObjectId,
  ): Promise<void> {
    await this.unlinkMany(operator, [
      { type: "role_permission", firstId: roleId, secondId: permissionId },
    ]);
  }

  /** 多個角色綁定的權限 id 聯集(ADR-0011 步驟 4)。 */
  listPermissionIdsOfRoles(
    roleIds: Types.ObjectId[],
  ): Promise<Types.ObjectId[]> {
    return this.secondIdsOf("role_permission", roleIds);
  }

  // ---- 通用讀取 ----

  /**
   * 批次取關聯(依任一端或兩端過濾),保留「哪一筆配哪一筆」的配對 —
   * `listXxxIdsOfYyy` 系列用 distinct 取聯集,配對資訊會掉。
   * 用途:使用者清單一次取整頁使用者的所屬組織(`org_user`)、角色授予(`user_role`)
   * 與這些角色的擁有組織(`org_role`),不必每列各打一次查詢。
   * 兩端都不給即回該類型全部(呼叫端自己負責範圍),空陣列的一端視為「查無」直接回空。
   */
  async listLinks(
    type: CoreRelationshipType,
    ends: { firstIds?: Types.ObjectId[]; secondIds?: Types.ObjectId[] },
  ): Promise<RelationRecord[]> {
    if (ends.firstIds?.length === 0 || ends.secondIds?.length === 0) {
      return [];
    }
    return this.model
      .find({
        type,
        ...(ends.firstIds ? { firstId: { $in: ends.firstIds } } : {}),
        ...(ends.secondIds ? { secondId: { $in: ends.secondIds } } : {}),
      })
      .lean<RelationRecord[]>()
      .exec();
  }

  /** 取一筆關聯(含 meta 與基礎欄位);不存在回 null。 */
  findLink(
    type: CoreRelationshipType,
    firstId: Types.ObjectId,
    secondId: Types.ObjectId,
  ): Promise<RelationRecord | null> {
    return this.model
      .findOne({ type, firstId, secondId })
      .lean<RelationRecord>()
      .exec();
  }

  // ---- 批次寫入原語 ----

  /**
   * 批次建立關聯;任一筆重複即拋 DuplicateRelationError(唯一索引防重,ADR-0001)。
   * 依序寫入、遇錯即停(非交易):呼叫端應先算好差集再寫,重複代表競態或程式錯誤。
   */
  async linkMany(
    operator: OperatorContext,
    links: RelationLink[],
  ): Promise<void> {
    if (links.length === 0) {
      return;
    }
    try {
      await this.model.insertMany(this.toDocuments(operator, links));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicateRelationError(
          "核心關聯已存在,或角色已有擁有組織(唯一索引拒絕,ADR-0001)",
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * 冪等的批次建立(供 seed 重跑):已存在的同一筆略過並計為「未變」,其餘寫入計為「新增」。
   * 唯一索引擋下但同一筆不存在者(= org_role 的角色已有別的擁有組織)是衝突,不是未變 → 拒絕。
   */
  async ensureLinks(
    operator: OperatorContext,
    links: RelationLink[],
  ): Promise<EnsureLinksResult> {
    if (links.length === 0) {
      return { created: 0, unchanged: 0 };
    }
    try {
      await this.model.insertMany(this.toDocuments(operator, links), {
        ordered: false,
        throwOnValidationError: true,
      });
      return { created: links.length, unchanged: 0 };
    } catch (error) {
      const failures = bulkWriteFailuresOf(error);
      if (!failures) {
        throw error;
      }
      for (const failure of failures) {
        const link = links[failure.index];
        if (
          failure.code !== DUPLICATE_KEY_CODE ||
          !link ||
          !(await this.exists(link))
        ) {
          throw new DuplicateRelationError(
            "核心關聯寫入被拒絕:角色已有擁有組織,或發生非防重的寫入錯誤(ADR-0001)",
            { cause: error },
          );
        }
      }
      return {
        created: links.length - failures.length,
        unchanged: failures.length,
      };
    }
  }

  /**
   * 批次移除關聯,回傳實際移除筆數。
   * 關聯是「有/沒有」的事實,採硬刪除而非軟刪除(ADR-0007 的軟刪除針對實體資料):
   * 唯一索引含已軟刪除的文件,軟刪會讓「移除後再加入」被防重索引擋下。
   * 移除不留 updatedBy;授權變更的稽核由 audit_logs 承擔(ADR-0004)。
   */
  async unlinkMany(
    _operator: OperatorContext,
    links: Omit<RelationLink, "meta">[],
  ): Promise<number> {
    if (links.length === 0) {
      return 0;
    }
    const { deletedCount } = await this.model.deleteMany({
      $or: links.map(({ type, firstId, secondId }) => ({
        type,
        firstId,
        secondId,
      })),
    });
    return deletedCount;
  }

  /** 組成落庫文件:`thirdId` 保留欄位一律 null(ADR-0001);createdBy / updatedBy 由操作者填(insertMany 不走 save 中介層)。 */
  private toDocuments(
    operator: OperatorContext,
    links: RelationLink[],
  ): Partial<CoreRelationship & BaseFields>[] {
    return links.map((link) => ({
      ...link,
      thirdId: null,
      createdBy: operator.actorId,
      updatedBy: operator.actorId,
    }));
  }

  private async exists(link: RelationLink): Promise<boolean> {
    const found = await this.model
      .exists({
        type: link.type,
        firstId: link.firstId,
        secondId: link.secondId,
      })
      .exec();
    return found !== null;
  }

  private secondIdsOf(
    type: CoreRelationshipType,
    firstIds: Types.ObjectId[],
  ): Promise<Types.ObjectId[]> {
    return this.model
      .distinct("secondId", { type, firstId: { $in: firstIds } })
      .exec();
  }

  private firstIdsOf(
    type: CoreRelationshipType,
    secondIds: Types.ObjectId[],
  ): Promise<Types.ObjectId[]> {
    return this.model
      .distinct("firstId", { type, secondId: { $in: secondIds } })
      .exec();
  }
}
