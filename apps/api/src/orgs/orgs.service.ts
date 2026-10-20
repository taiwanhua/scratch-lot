import { Injectable, Logger } from "@nestjs/common";
import { Types } from "mongoose";

import { isValidTimezone } from "@repo/domain/form";

import { AuditService } from "../audit/audit.service";
import { OrgsRepository, RolesRepository } from "../database/database.module";
import {
  type OperatorContext,
  isOrgManaged,
  isOrgVisible,
} from "../database/operator-context";
import { OrgBusinessDataReader } from "../database/org-business-data.reader";
import { RelationService } from "../database/relation.service";
import { tenantIdOfOrg } from "../database/tenant-id";
import { StorageService, isOwnedUploadPath } from "../storage/storage.service";
import type { CreateChildOrgInput } from "./dto/create-child-org.input";
import type { DeleteOrgInput } from "./dto/delete-org.input";
import type { MoveOrgInput } from "./dto/move-org.input";
import type { SetOrgEnabledInput } from "./dto/set-org-enabled.input";
import type { SetOrgTimezoneInput } from "./dto/set-org-timezone.input";
import type { SetOrgVisibilityInput } from "./dto/set-org-visibility.input";
import type { UpdateOrgInput } from "./dto/update-org.input";
import type { DeletePayload } from "./models/org-payloads.model";
import { type Org, OrgNode, type TenantOrgNode } from "./models/org.model";
import {
  type OrgNotDeletableReason,
  orgError,
  orgNotDeletableError,
  orgValidationError,
} from "./org-error";
import {
  type OrgRecord,
  TIMEZONE_SETTING,
  VISIBILITY_SETTING,
  hasOwnTimezone,
  isTenantTop,
  tenantTopIdOf,
  timezoneOf,
  toOrg,
  visibilityOf,
  visibilitySettingOf,
} from "./org-mapper";
import { assertSlugFree, requireSlug, slugConflictOr } from "./org-slug";
import { OwnerProtectionService } from "./owner-protection.service";

/** 審計動作名(docs/modules/org-manager.md「審計」;`targetType` 一律 org)。 */
const AUDIT_TARGET_TYPE = "org";
const AUDIT_ACTIONS = {
  createChild: "org.create-child",
  edit: "org.edit",
  toggleEnabled: "org.toggle-enabled",
  move: "org.move",
  delete: "org.delete",
  setVisibility: "org.set-visibility",
  setTimezone: "org.set-timezone",
} as const;

/**
 * 前置檢查的豁免名單(`orgContentReasons`):**這次動作會一併抹掉的東西**,因此不算「還有別的資料」。
 * 目前唯一的使用者是撤銷開通:擁有者使用者 + 租戶管理員副本。
 */
export interface OrgContentExemptions {
  userIds?: Types.ObjectId[];
  roleIds?: Types.ObjectId[];
}

/** 編輯可動的欄位(擁有者屬租戶作業、可見範圍開關另有 mutation,都不在此)。 */
type EditablePath = "name" | "description" | "logoPath" | "slug";

/** 一個欄位的變動;`value` / `previous` 為 undefined 代表「沒有值 / 清空」。 */
interface OrgFieldChange {
  path: EditablePath;
  value: string | undefined;
  previous: string | undefined;
}

/**
 * 讀 / 寫「操作者已確認可操作的組織」底下整棵子樹時用的上下文:**兩個範圍**暫時提升為 `"all"`。
 *
 * **只准搭配把查詢釘在該子樹內的條件**(`ancestors: <已驗過的組織 id>`,或由那種查詢取回的 id)。
 * 理由:管理範圍決定「動得了誰」(ADR-0005),但停用連動、搬移後的 `ancestors` 重算、
 * 刪除前置的「有沒有子組織」三件事的正確性以**整棵子樹**為準 —
 * 不能因為操作者的管理範圍只到某一層就只改一半、或誤判成沒有子組織。
 * 管理範圍換掉可見範圍成為治理類的過濾依據後,兩個都要放開才擋得住漏改。
 */
function subtreeContext(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/** 名稱是必填且不可只有空白;回傳去空白後的值。 */
function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw orgError("VALIDATION_FAILED", "Org name must not be empty");
  }
  return trimmed;
}

/** 空白 / 空字串視同「清空這個欄位」。 */
function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/** 商標只收本 API 自己簽出來的路徑,不讓呼叫端把任意 bucket 物件塞進 DB(ADR-0010)。 */
function ownedLogoPath(value: string | null): string | undefined {
  const logoPath = optionalText(value);
  if (logoPath !== undefined && !isOwnedUploadPath(logoPath)) {
    throw orgError(
      "VALIDATION_FAILED",
      `logoPath ${logoPath} was not issued by createUploadUrl`,
    );
  }
  return logoPath;
}

/** 根組織 = 沒有上層的那一筆(種子資料,ADR-0002);租戶頂層與以下都不是。 */
function isRootOrg(org: OrgRecord): boolean {
  return org.parentId === null;
}

/** 算出這次編輯真正變動的欄位(沒變的不寫、不入審計)。 */
function editChangesOf(
  input: UpdateOrgInput,
  current: OrgRecord,
): OrgFieldChange[] {
  const changes: OrgFieldChange[] = [];
  if (input.name !== undefined && input.name !== null) {
    const name = requireName(input.name);
    if (name !== current.name) {
      changes.push({ path: "name", value: name, previous: current.name });
    }
  }
  if (input.description !== undefined) {
    const description = optionalText(input.description);
    // 根組織清空後存的是 null(見 updateOf):與「沒有值」同義,再清空一次不算變動
    const previous = current.description ?? undefined;
    // 例外:根組織上**欄位根本不存在**(過去被 `$unset` 的舊資料)時,明確清空要真的寫下 null —
    // 不寫的話 seed 會把它當成「從未寫過」補回宣告值(ADR-0002)。只發生一次,之後就是 null
    const clearsMissingRootField =
      description === undefined &&
      current.description === undefined &&
      isRootOrg(current);
    if (description !== previous || clearsMissingRootField) {
      changes.push({ path: "description", value: description, previous });
    }
  }
  if (input.logoPath !== undefined) {
    const logoPath = ownedLogoPath(input.logoPath);
    if (logoPath !== current.logoPath) {
      changes.push({
        path: "logoPath",
        value: logoPath,
        previous: current.logoPath,
      });
    }
  }
  return changes;
}

/**
 * 清空時要**留著欄位、寫 `null`** 的欄位:根組織的描述是初始 seed 值欄位(ADR-0002),
 * seed 只補「不存在的欄位」— `$unset` 掉的話下次部署就被翻回宣告值,清空等於沒清。
 * 其他組織不是種子資料,維持 `$unset`。
 */
function nullOnClearPathsOf(current: OrgRecord): ReadonlySet<EditablePath> {
  return new Set<EditablePath>(isRootOrg(current) ? ["description"] : []);
}

/** 變動清單 → Mongo update(有值 `$set`;清空 `$unset`,`nullOnClear` 列出的欄位改 `$set: null`)。 */
function updateOf(
  changes: OrgFieldChange[],
  nullOnClear: ReadonlySet<EditablePath>,
): Record<string, unknown> {
  const set: Record<string, string | null> = {};
  const unset: Record<string, ""> = {};
  for (const change of changes) {
    if (change.value !== undefined) {
      set[change.path] = change.value;
    } else if (nullOnClear.has(change.path)) {
      set[change.path] = null;
    } else {
      unset[change.path] = "";
    }
  }
  return {
    ...(Object.keys(set).length === 0 ? {} : { $set: set }),
    ...(Object.keys(unset).length === 0 ? {} : { $unset: unset }),
  };
}

/** 變動清單 → 審計的 before / after(只放有變的欄位;清空記成 null)。 */
function auditSideOf(
  changes: OrgFieldChange[],
  side: "value" | "previous",
): Record<string, unknown> {
  return Object.fromEntries(
    changes.map((change) => [change.path, change[side] ?? null]),
  );
}

/** 同層依名稱排序,讓樹的順序穩定(不依賴寫入順序)。 */
function byName(documents: OrgRecord[]): OrgRecord[] {
  return documents.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/**
 * 由平坦的組織清單組回樹(森林:`rootIds` 可能有多個根)。
 *
 * 每棵樹的樹根對外一律回 `parentId: null`(它的上層不在樹上,給了前端也查不到)。
 * 因此**前端不能拿 `parentId` 判斷「樹根是不是平台根組織」** — 租戶視角的樹根也是 null;
 * 那件事由 `org(樹根).isSystem` 回答(`useOrgManagerData.ts`)。
 */
function buildForest(
  documents: OrgRecord[],
  rootIds: Types.ObjectId[],
  isInScope: (id: Types.ObjectId) => boolean,
): OrgNode[] {
  const rootKeys = new Set(rootIds.map(String));
  const childrenByParent = new Map<string, OrgRecord[]>();
  for (const document of documents) {
    if (document.parentId === null || rootKeys.has(String(document._id))) {
      continue;
    }
    const key = String(document.parentId);
    const siblings = childrenByParent.get(key) ?? [];
    siblings.push(document);
    childrenByParent.set(key, siblings);
  }
  const toNode = (document: OrgRecord): OrgNode => ({
    id: String(document._id),
    name: document.name,
    parentId:
      rootKeys.has(String(document._id)) || document.parentId === null
        ? null
        : String(document.parentId),
    enabled: document.enabled,
    // 僅租戶頂層有值(ADR-0009);樹上就給,前端不必逐筆查 org(id) 才判斷得出擁有者
    ownerUserId:
      document.ownerUserId === undefined ? null : String(document.ownerUserId),
    // 管理範圍外的節點根本不會出現在樹上,這個欄位因此恆為 false;
    // 保留是為了與使用者列的 `roles[].outOfScope` 命名一致、且不必同步改前端(GQL-05 相容)
    outOfScope: !isInScope(document._id),
    children: byName(childrenByParent.get(String(document._id)) ?? []).map(
      (child) => toNode(child),
    ),
  });
  const roots = documents.filter((document) =>
    rootKeys.has(String(document._id)),
  );
  return byName(roots).map((document) => toNode(document));
}

/**
 * 組織管理(docs/modules/org-manager.md)的業務邏輯:resolver 薄、service 厚(STRUCT-01)。
 * 資料存取一律經 OrgsRepository / RelationService;每個寫入動作由 resolver 以
 * `@RequirePermission` 守門,本層負責規則、審計與錯誤碼。
 */
@Injectable()
export class OrgsService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly audit: AuditService,
    private readonly businessData: OrgBusinessDataReader,
    private readonly roles: RolesRepository,
    private readonly protection: OwnerProtectionService,
    private readonly storage: StorageService,
  ) {}

  private readonly logger = new Logger(OrgsService.name);

  /**
   * **管理範圍**的組織樹(CONTEXT.md「管理範圍」;ADR-0005 的分工表)。
   * 根 = 管理範圍的各個頂點,**可能有多個**(持兩個沒有共同上層的角色就有兩棵樹);
   * 根組織成員以根組織為根、看得到全部租戶。管理範圍外的組織**不出現**在樹上。
   */
  async tree(operator: OperatorContext): Promise<OrgNode[]> {
    const rootIds = await this.treeRootIds(operator);
    if (rootIds.length === 0) {
      return [];
    }
    // 讀取範圍由 rootIds 釘死在「管理範圍的各頂點子樹」內 = 管理範圍本身
    const documents = await this.orgs.findMany(subtreeContext(operator), {
      $or: [{ _id: { $in: rootIds } }, { ancestors: { $in: rootIds } }],
    });
    return buildForest(documents, rootIds, (id) => isOrgManaged(operator, id));
  }

  /**
   * **整棵租戶樹**(組織選擇器的 `visible` / `tenant` 模式;`tenantOrgTree`):當前組織所屬租戶的整棵樹
   * (租戶頂層與全部下層),每個節點帶「在可見範圍內」「在管理範圍內」兩個旗標,由前端依模式決定哪些能選;
   * 名稱以外不多給。**釘在當前組織的租戶**:別的租戶不會出現。根組織成員(可見範圍 `"all"`)= 從根組織起的整棵樹。
   * 只要登入,不要求治理權限。
   */
  async tenantTree(operator: OperatorContext): Promise<TenantOrgNode[]> {
    const reader = subtreeContext(operator);
    let topId: Types.ObjectId;
    if (operator.visibleOrgIds === "all") {
      const root = await this.orgs.findOne(reader, { parentId: null });
      if (root === null) {
        return [];
      }
      topId = root._id;
    } else {
      if (operator.currentOrgId === null) {
        return [];
      }
      const current = await this.orgs.findById(reader, operator.currentOrgId);
      const tenantId = current === null ? null : tenantIdOfOrg(current);
      if (tenantId === null) {
        return [];
      }
      topId = tenantId;
    }
    const documents = await this.orgs.findMany(reader, {
      $or: [{ _id: topId }, { ancestors: topId }],
    });
    const childrenByParent = new Map<string, OrgRecord[]>();
    for (const document of documents) {
      if (
        String(document._id) === String(topId) ||
        document.parentId === null
      ) {
        continue;
      }
      const key = String(document.parentId);
      childrenByParent.set(key, [
        ...(childrenByParent.get(key) ?? []),
        document,
      ]);
    }
    const toNode = (document: OrgRecord, isTop: boolean): TenantOrgNode => ({
      id: String(document._id),
      name: document.name,
      parentId:
        isTop || document.parentId === null ? null : String(document.parentId),
      enabled: document.enabled,
      isVisible: isOrgVisible(operator, document._id),
      isManaged: isOrgManaged(operator, document._id),
      children: byName(childrenByParent.get(String(document._id)) ?? []).map(
        (child) => toNode(child, false),
      ),
    });
    const top = documents.find(
      (document) => String(document._id) === String(topId),
    );
    return top === undefined ? [] : [toNode(top, true)];
  }

  /** 單一組織:管理範圍外視為不存在(不透露差別)。 */
  async one(operator: OperatorContext, id: string): Promise<Org> {
    return toOrg(await this.requireManaged(operator, id));
  }

  async createChild(
    operator: OperatorContext,
    input: CreateChildOrgInput,
  ): Promise<Org> {
    const name = requireName(input.name);
    const description = optionalText(input.description);
    const parent = await this.requireManaged(operator, input.parentId);
    const created = await this.orgs.create(operator, {
      name,
      parentId: parent._id,
      ancestors: [...parent.ancestors, parent._id],
      enabled: true,
      isSystem: false,
      settings: {},
      ...(description === undefined ? {} : { description }),
    });
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.createChild,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: {
        name,
        parentId: String(parent._id),
        ...(description === undefined ? {} : { description }),
      },
    });
    return toOrg(created);
  }

  /**
   * 編輯:名稱、描述、商標三個欄位。沒有任何欄位真的變動時不寫入、也不留審計
   * (審計的 before / after 只放有變的欄位,空紀錄是雜訊)。
   */
  async update(operator: OperatorContext, input: UpdateOrgInput): Promise<Org> {
    const current = await this.requireManaged(operator, input.id);
    const slugChange = await this.slugChangeOf(operator, input, current);
    const changes = [
      ...editChangesOf(input, current),
      ...(slugChange ? [slugChange] : []),
    ];
    if (changes.length === 0) {
      return toOrg(current);
    }
    const updated = await this.orgs
      .updateById(
        operator,
        current._id,
        updateOf(changes, nullOnClearPathsOf(current)),
      )
      .catch((error: unknown) => {
        // 短碼事前查過沒人用,同時有別的請求搶先寫入時由唯一索引擋下
        throw slugConflictOr(error);
      });
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.edit,
      targetType: AUDIT_TARGET_TYPE,
      targetId: current._id,
      before: auditSideOf(changes, "previous"),
      after: auditSideOf(changes, "value"),
    });
    await this.discardReplacedLogo(changes);
    return toOrg(updated ?? current);
  }

  /**
   * 租戶短碼的變動:未給 / null = 不動;只有租戶頂層有短碼、只有根組織的操作者能改
   * (短碼是客製表單 key 的預設後綴,改它是平台層級的事,不交給租戶自己)。
   */
  private async slugChangeOf(
    operator: OperatorContext,
    input: UpdateOrgInput,
    current: OrgRecord,
  ): Promise<OrgFieldChange | null> {
    if (input.slug === undefined || input.slug === null) {
      return null;
    }
    if (!(await this.protection.isRootOperator(operator))) {
      throw orgError("FORBIDDEN", "Only the root org can change a tenant slug");
    }
    if (!isTenantTop(current)) {
      throw orgValidationError("Only a tenant top org has a slug", ["slug"]);
    }
    const slug = requireSlug(input.slug);
    if (slug === current.slug) {
      return null;
    }
    await assertSlugFree(this.orgs, operator, slug);
    return { path: "slug", value: slug, previous: current.slug };
  }

  /**
   * 換商標 / 清空商標之後,把**舊的**物件刪掉(換圖即刪舊;ADR-0010)。
   *
   * 只在更新已經成功之後做,而且**刪不掉只記 warn、不往外拋** — 清不掉的後果是 bucket 裡
   * 留一個沒人引用的孤兒物件(幾百 KB),不該因此讓使用者的編輯失敗、更不該回滾已寫好的資料。
   * `changes` 只會在新值與舊值真的不同時帶 `logoPath`,所以「送同一張圖」不會走到這裡;
   * 舊值不是本 API 簽出來的路徑(歷史殘留 / 被塞進來的值)由 `deleteObject` 的
   * `isOwnedUploadPath` 擋下,不會刪到任意物件。
   */
  private async discardReplacedLogo(changes: OrgFieldChange[]): Promise<void> {
    const previous = changes.find(
      (change) => change.path === "logoPath",
    )?.previous;
    if (previous === undefined) {
      return;
    }
    try {
      await this.storage.deleteObject(previous);
    } catch (error) {
      this.logger.warn(
        `舊商標 ${previous} 刪除失敗,bucket 會留下孤兒物件:${String(error)}`,
      );
    }
  }

  /**
   * 停用 / 啟用:**停用連動整棵子樹**;啟用只啟用自己這一節,下層各自處理
   * (docs/modules/org-manager.md「停用 / 啟用」)。根組織不可停用 — 停掉等於整個平台關門。
   */
  async setEnabled(
    operator: OperatorContext,
    input: SetOrgEnabledInput,
  ): Promise<Org> {
    const current = await this.requireManaged(operator, input.id);
    if (current.isSystem && !input.enabled) {
      throw orgError("VALIDATION_FAILED", "System org cannot be disabled");
    }
    // 租戶頂層只有根組織能停用 / 啟用(ADR-0009);租戶內的人只能動子組織
    await this.protection.assertTenantTopOperableBy(
      operator,
      current,
      "set-enabled",
    );
    const updated = await this.orgs.updateById(operator, current._id, {
      $set: { enabled: input.enabled },
    });
    const cascaded = input.enabled
      ? 0
      : await this.orgs.updateMany(
          subtreeContext(operator),
          { ancestors: current._id },
          { $set: { enabled: false } },
        );
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.toggleEnabled,
      targetType: AUDIT_TARGET_TYPE,
      targetId: current._id,
      before: { enabled: current.enabled },
      after: {
        enabled: input.enabled,
        ...(input.enabled ? {} : { cascadedDescendants: cascaded }),
      },
    });
    return toOrg(updated ?? current);
  }

  /**
   * 搬移:候選 = **管理範圍內、同租戶、不在自己這棵子樹裡**(docs/modules/org-manager.md)。
   * 範圍外 `NOT_FOUND`、跨租戶 `CROSS_TENANT`、搬進自己的子樹 `CYCLIC_MOVE`、
   * 租戶頂層本身 `FORBIDDEN`;成功後整棵子樹的 `ancestors` 重算(物化路徑,ADR-0005)。
   */
  async move(operator: OperatorContext, input: MoveOrgInput): Promise<Org> {
    const org = await this.requireManaged(operator, input.id);
    if (org.parentId === null || org.isSystem) {
      throw orgError("VALIDATION_FAILED", "System org cannot be moved");
    }
    // 租戶頂層只有根組織能搬(跨租戶的檢查在下面另外擋,ADR-0009)
    await this.protection.assertTenantTopOperableBy(operator, org, "move");
    // 新上層也必須在管理範圍內(治理類過濾自動套用:範圍外即 NOT_FOUND)
    const newParent = await this.requireManaged(operator, input.newParentId);
    if (
      newParent._id.equals(org._id) ||
      newParent.ancestors.some((ancestor) => ancestor.equals(org._id))
    ) {
      throw orgError(
        "CYCLIC_MOVE",
        `Org ${input.id} cannot be moved under itself or its own descendant`,
      );
    }
    if (!tenantTopIdOf(org).equals(tenantTopIdOf(newParent))) {
      throw orgError(
        "CROSS_TENANT",
        `Org ${input.id} and new parent ${input.newParentId} belong to different tenants`,
      );
    }
    if (org.parentId.equals(newParent._id)) {
      return toOrg(org);
    }

    const ancestors = [...newParent.ancestors, newParent._id];
    const updated = await this.orgs.updateById(operator, org._id, {
      $set: { parentId: newParent._id, ancestors },
    });
    const moved = await this.reparentDescendants(operator, org, ancestors);
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.move,
      targetType: AUDIT_TARGET_TYPE,
      targetId: org._id,
      before: { parentId: String(org.parentId) },
      after: { parentId: String(newParent._id), movedDescendants: moved },
    });
    return toOrg(updated ?? org);
  }

  /**
   * 刪除:前置四項(無子組織 / 無成員 / 非角色擁有組織 / 無業務資料引用)全過才可;
   * 任一不過回 `ORG_NOT_DELETABLE` 附 reasons,前端提示改用停用。刪除 = 軟刪除(ADR-0007)。
   * 「非角色擁有組織」**只算存活的角色**(見 `ownsAliveRole`)。
   */
  async remove(
    operator: OperatorContext,
    input: DeleteOrgInput,
  ): Promise<DeletePayload> {
    const org = await this.requireManaged(operator, input.id);
    // 租戶頂層只有根組織能刪(ADR-0009);先於前置四項判斷,不透露租戶內部狀態
    await this.protection.assertTenantTopOperableBy(operator, org, "delete");
    const reasons = await this.orgContentReasons(operator, org);
    if (reasons.length > 0) {
      throw orgNotDeletableError(reasons);
    }
    await this.orgs.softDeleteById(operator, org._id);
    // 主管是組織的職位:組織不在了職位也不在(關聯只存現況、硬刪,ADR-0001);
    // 留著的話,審核流程的主管解析不會走到被刪的組織,但名單會變成指向死組織的殭屍
    const managerLinks = await this.relations.listLinks("org_manager", {
      firstIds: [org._id],
    });
    const removedManagerIds = managerLinks.map((link) => String(link.secondId));
    await this.relations.unlinkMany(
      operator,
      managerLinks.map((link) => ({
        type: "org_manager" as const,
        firstId: link.firstId,
        secondId: link.secondId,
      })),
    );
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.delete,
      targetType: AUDIT_TARGET_TYPE,
      targetId: org._id,
      before: {
        name: org.name,
        parentId: org.parentId === null ? null : String(org.parentId),
        ...(removedManagerIds.length === 0
          ? {}
          : { managerIds: removedManagerIds }),
      },
    });
    return { success: true, deletedId: String(org._id) };
  }

  /**
   * 可見範圍開關(ADR-0005):只掛**租戶頂層**、套用整棵子樹,改的是租戶自己的資料政策
   * (下層使用者看不看得到下層組織的**業務資料**),**不影響治理頁、角色資格與管理範圍**。
   *
   * 2026-09-19 起不再是根組織專屬:權限由 `system.org-manager.tenant-ops.set-visibility`
   * 搬到 `system.org-manager.set-visibility`,租戶管理員模板自動取得;
   * 能設哪些則由**管理範圍**決定 — 範圍外的租戶頂層查不到(`NOT_FOUND`),
   * 所以租戶管理員只設得了自己的租戶,根組織(範圍 = 全部)照樣設得了任何一個。
   */
  async setVisibility(
    operator: OperatorContext,
    input: SetOrgVisibilityInput,
  ): Promise<Org> {
    const org = await this.requireManaged(operator, input.orgId);
    if (!isTenantTop(org)) {
      const error = orgError(
        "VALIDATION_FAILED",
        `Org ${input.orgId} is not a tenant top-level org; the visibility switch only exists there`,
      );
      (error.extensions as Record<string, unknown>).fields = ["orgId"];
      throw error;
    }
    const previous = visibilityOf(org);
    if (previous === input.visibility) {
      return toOrg(org);
    }
    const updated = await this.orgs.updateById(operator, org._id, {
      $set: {
        [`settings.${VISIBILITY_SETTING}`]: visibilitySettingOf(
          input.visibility,
        ),
      },
    });
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.setVisibility,
      targetType: AUDIT_TARGET_TYPE,
      targetId: org._id,
      before: { visibility: previous },
      after: { visibility: input.visibility },
    });
    return toOrg(updated ?? org);
  }

  /**
   * 時區(`orgs.settings.timezone`):掛在**根組織**(根組織與它自己的資料)與**租戶頂層**(整個租戶共用)——
   * 日期時間的顯示、日期欄的「當天」、資料範圍規則的日期條件都以它換算(讀取端 `tenantTimezoneOf`)。
   * 範圍與可見範圍開關同一套:範圍外的組織查不到(`NOT_FOUND`;根組織只有根組織的人管得到),
   * 兩者以外的組織 `VALIDATION_FAILED`。
   * `timezone = null` 清除設定、退回預設時區;值要是 `Intl` 認得的 IANA 名稱。
   */
  async setTimezone(
    operator: OperatorContext,
    input: SetOrgTimezoneInput,
  ): Promise<Org> {
    const org = await this.requireManaged(operator, input.orgId);
    if (!hasOwnTimezone(org)) {
      throw orgValidationError(
        `Org ${input.orgId} is neither the root org nor a tenant top-level org; the timezone setting only exists there`,
        ["orgId"],
      );
    }
    if (input.timezone !== null && !isValidTimezone(input.timezone)) {
      throw orgValidationError("timezone is not an IANA name Intl recognizes", [
        "timezone",
      ]);
    }
    // 比對存的原值(不合法的舊值也要能被清掉),稽核的 before 則記對外看到的值
    if ((org.settings[TIMEZONE_SETTING] ?? null) === input.timezone) {
      return toOrg(org);
    }
    const previous = timezoneOf(org);
    const updated = await this.orgs.updateById(
      operator,
      org._id,
      input.timezone === null
        ? { $unset: { [`settings.${TIMEZONE_SETTING}`]: "" } }
        : { $set: { [`settings.${TIMEZONE_SETTING}`]: input.timezone } },
    );
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.setTimezone,
      targetType: AUDIT_TARGET_TYPE,
      targetId: org._id,
      before: { timezone: previous },
      after: { timezone: input.timezone },
    });
    return toOrg(updated ?? org);
  }

  /**
   * 樹根 = **管理範圍的各個頂點**:管理範圍是「各擁有組織的子樹」的聯集,
   * 頂點就是那些「祖先鏈上沒有別的管理範圍內組織」的節點 — 一個角色一個頂點,
   * 上下包含關係的角色自動收斂成一個。`"all"`(超級管理員 / 擁有組織是根組織)= 根組織一棵。
   */
  private async treeRootIds(
    operator: OperatorContext,
  ): Promise<Types.ObjectId[]> {
    if (operator.managedOrgIds === "all") {
      const root = await this.orgs.findOne(operator, { parentId: null });
      return root === null ? [] : [root._id];
    }
    if (operator.managedOrgIds.length === 0) {
      return [];
    }
    const managed = await this.orgs.findMany(operator, {
      _id: { $in: operator.managedOrgIds },
    });
    const managedKeys = new Set(managed.map((org) => String(org._id)));
    return managed
      .filter(
        (org) =>
          !org.ancestors.some((ancestor) => managedKeys.has(String(ancestor))),
      )
      .map((org) => org._id);
  }

  /** 管理範圍外(治理類過濾自動套用)視為不存在 — 不透露「存在但你動不了」。 */
  private async requireManaged(
    operator: OperatorContext,
    id: string,
  ): Promise<OrgRecord> {
    const org = Types.ObjectId.isValid(id)
      ? await this.orgs.findById(operator, id)
      : null;
    if (org === null) {
      throw orgError("NOT_FOUND", `Org ${id} not found`);
    }
    return org;
  }

  /** 搬移後重算子樹的 `ancestors`:把「到被搬組織為止」的前段換成它的新祖先鏈。 */
  private async reparentDescendants(
    operator: OperatorContext,
    org: OrgRecord,
    ancestors: Types.ObjectId[],
  ): Promise<number> {
    const subtree = subtreeContext(operator);
    const descendants = await this.orgs.findMany(subtree, {
      ancestors: org._id,
    });
    for (const descendant of descendants) {
      const index = descendant.ancestors.findIndex((ancestor) =>
        ancestor.equals(org._id),
      );
      const tail = index === -1 ? [org._id] : descendant.ancestors.slice(index);
      await this.orgs.updateById(subtree, descendant._id, {
        $set: { ancestors: [...ancestors, ...tail] },
      });
    }
    return descendants.length;
  }

  /**
   * 「這個組織底下還有沒有別的東西」的**唯一**判斷點:刪除(`remove`)與撤銷開通
   * (`TenantOpsService.revokeProvision`)共用,不各寫一套。
   *
   * `exempt` 是「這次動作會一併抹掉的東西,因此不算數」:撤銷開通會連擁有者使用者與
   * 租戶管理員副本一起硬刪,所以那兩筆不該讓 `HAS_MEMBERS` / `OWNS_ROLES` 成立;
   * 刪除不傳 `exempt`,行為與原本完全相同。
   */
  async orgContentReasons(
    operator: OperatorContext,
    org: OrgRecord,
    exempt: OrgContentExemptions = {},
  ): Promise<OrgNotDeletableReason[]> {
    const exemptUserKeys = new Set((exempt.userIds ?? []).map(String));
    const exemptRoleKeys = new Set((exempt.roleIds ?? []).map(String));
    const reasons: OrgNotDeletableReason[] = [];
    if (org.isSystem || org.parentId === null) {
      reasons.push("SYSTEM_ORG");
    }
    // 子組織以整棵子樹判定(可見範圍外也算),不然可見範圍 own 的人會誤判成沒有子組織
    const children = await this.orgs.count(subtreeContext(operator), {
      ancestors: org._id,
    });
    if (children > 0) {
      reasons.push("HAS_CHILDREN");
    }
    const memberIds = await this.relations.listUserIdsOfOrg(org._id);
    if (memberIds.some((id) => !exemptUserKeys.has(String(id)))) {
      reasons.push("HAS_MEMBERS");
    }
    if (await this.ownsAliveRole(operator, org._id, exemptRoleKeys)) {
      reasons.push("OWNS_ROLES");
    }
    // 「無業務資料引用」:清單與查法的正本是資料登記 + OrgBusinessDataReader(查詢失敗會拋出,不當成沒有)
    if (await this.businessData.hasBusinessData(operator, org._id)) {
      reasons.push("HAS_BUSINESS_DATA");
    }
    return reasons;
  }

  /**
   * 「非角色擁有組織」前置:**只算存活的角色**。
   *
   * `org_role` 關聯在角色被軟刪除時刻意不動(ADR-0007 軟刪除、ADR-0001 關聯不連動),
   * 所以光看關聯會把「角色都刪光了」的組織永遠判成不可刪。角色文件經 `this.roles` 讀,
   * `deletedAt` 有值的預設就查不到(ADR-0007),過濾因此不必寫在這裡。
   * 上下文用 `subtreeContext`:`roles` 沒掛租戶過濾,但前置檢查問的是「有沒有」,
   * 不是「你看不看得到」— 與 `OrgBusinessDataReader.hasBusinessData` 同一條理由。
   */
  private async ownsAliveRole(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    exemptRoleKeys: ReadonlySet<string>,
  ): Promise<boolean> {
    const owned = await this.relations.listRoleIdsOfOrg(orgId);
    const ownedRoleIds = owned.filter(
      (roleId) => !exemptRoleKeys.has(String(roleId)),
    );
    if (ownedRoleIds.length === 0) {
      return false;
    }
    const alive = await this.roles.count(subtreeContext(operator), {
      _id: { $in: ownedRoleIds },
    });
    return alive > 0;
  }
}
