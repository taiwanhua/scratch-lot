import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  type DemoItemTwoDocument,
  DemoItemsTwoRepository,
  type UserDocument,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import { notFoundError, validationError } from "./demo-items-two-error";
import type { CreateDemoItemTwoInput } from "./dto/create-demo-item-two.input";
import type { DeleteDemoItemTwoInput } from "./dto/delete-demo-item-two.input";
import {
  DEFAULT_PAGE_SIZE,
  type DemoItemsTwoInput,
  MAX_PAGE_SIZE,
} from "./dto/demo-items-two.input";
import type { SetDemoItemTwoEnabledInput } from "./dto/set-demo-item-two-enabled.input";
import type { UpdateDemoItemTwoInput } from "./dto/update-demo-item-two.input";
import type {
  DeleteDemoItemTwoPayload,
  DemoItemsTwoPayload,
} from "./models/demo-item-two-payloads.model";
import type {
  DemoItemTwoAbilitiesModel,
  DemoItemTwoModel,
} from "./models/demo-item-two.model";

type ItemRecord = Persisted<DemoItemTwoDocument>;
type UserRecord = Persisted<UserDocument>;

/** 權限表(`docs/modules/demo.sample-two.md`);`abilities` 與寫入守門看的是同一組 key。 */
const PERMISSION = {
  edit: "demo.sample-two.edit",
  delete: "demo.sample-two.delete",
} as const;

/** 審計動作名(demo.sample-two.md「審計」);`targetType` 一律 `demo_item_two`。 */
const AUDIT_TARGET_TYPE = "demo_item_two";
const AUDIT = {
  create: "demo-item-two.create",
  edit: "demo-item-two.edit",
  delete: "demo-item-two.delete",
  toggleEnabled: "demo-item-two.toggle-enabled",
} as const;

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值。 */
function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw validationError(`${field} is required`, [field]);
  }
  return trimmed;
}

function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

/**
 * 示範模組2(`demo.sample-two`)的 CRUD —— 示範家族的**對照組**。
 * resolver 薄、service 厚(STRUCT-01);寫入一律經 BaseRepository。
 *
 * **它刻意什麼都不做**:沒有欄位級投影、沒有附件、沒有歷程,也沒有自己的錯誤碼。
 * 查詢一律經 `DemoItemsTwoRepository`,租戶保底由 `tenantScopePlugin` 自動套上;
 * 而 `demo_items_two` **沒有** seed 宣告 `dataScopeTarget`,所以資料範圍規則的 provider
 * 對它一律回 null(`plugins/tenant-scope.plugin.ts` 的 `applyDataScope`)——
 * 這就是 `permission-scenarios.md` 劇本 3 要證明的「規則機制不介入」。
 *
 * 唯一多做的一件事是 `abilities`:把「這位操作者對這一筆能做什麼」算好給前端(前端只讀不重算)。
 */
@Injectable()
export class DemoItemsTwoService {
  constructor(
    private readonly items: DemoItemsTwoRepository,
    private readonly users: UsersRepository,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  /** 清單:可見範圍內的項目(`keyword` 比對名稱與備註,`enabled` 缺席 = 不篩)。 */
  async list(
    operator: OperatorContext,
    input: DemoItemsTwoInput,
  ): Promise<DemoItemsTwoPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const keyword = input.keyword?.trim();
    const filter = {
      ...(input.enabled === undefined || input.enabled === null
        ? {}
        : { enabled: input.enabled }),
      ...(keyword
        ? {
            $or: [
              { name: { $regex: escapeRegex(keyword), $options: "i" } },
              { note: { $regex: escapeRegex(keyword), $options: "i" } },
            ],
          }
        : {}),
    };
    const totalCount = await this.items.count(operator, filter);
    const documents = await this.items.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.decorate(operator, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 單筆;可見範圍外或已刪除的視同不存在(`NOT_FOUND`)。 */
  async findOne(
    operator: OperatorContext,
    id: string,
  ): Promise<DemoItemTwoModel> {
    return this.decorateOne(operator, await this.mustFind(operator, id));
  }

  // ---- 寫 ----

  /** 新增:`orgId` = 操作者的當前組織、`createdBy` = 操作者(都由 BaseRepository 寫入)。 */
  async create(
    operator: OperatorContext,
    input: CreateDemoItemTwoInput,
  ): Promise<DemoItemTwoModel> {
    const name = requireText(input.name, "name");
    const note = input.note?.trim();
    const created = await this.items.create(operator, {
      name,
      ...(note ? { note } : {}),
      enabled: true,
    });
    await this.audit.record(operator, {
      action: AUDIT.create,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: { name, ...(note ? { note } : {}) },
    });
    return this.decorateOne(operator, created);
  }

  /** 編輯 name / note;缺席 = 不動,`note: null` = 清空(GQL-06)。 */
  async update(
    operator: OperatorContext,
    input: UpdateDemoItemTwoInput,
  ): Promise<DemoItemTwoModel> {
    const current = await this.mustFind(operator, input.id);
    const set: Record<string, unknown> = {};
    const unset: Record<string, string> = {};
    const before: Record<string, unknown> = {};
    if (input.name !== undefined) {
      set.name = requireText(input.name, "name");
      before.name = current.name;
    }
    if (input.note !== undefined) {
      before.note = current.note ?? null;
      const note = input.note?.trim();
      if (note) {
        set.note = note;
      } else {
        unset.note = "";
      }
    }
    const updated = await this.items.updateById(operator, current._id, {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    });
    if (!updated) {
      throw notFoundError(`demo item two not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.edit,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before,
      after: {
        ...set,
        ...(unset.note === undefined ? {} : { note: null }),
      },
    });
    return this.decorateOne(operator, updated);
  }

  /** 刪除:軟刪除(ADR-0007),之後預設查詢視為不存在、資料仍保留。 */
  async remove(
    operator: OperatorContext,
    input: DeleteDemoItemTwoInput,
  ): Promise<DeleteDemoItemTwoPayload> {
    const current = await this.mustFind(operator, input.id);
    const deleted = await this.items.softDeleteById(operator, current._id);
    if (!deleted) {
      throw notFoundError(`demo item two not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.delete,
      targetType: AUDIT_TARGET_TYPE,
      targetId: deleted._id,
      before: { name: current.name },
    });
    return { success: true, deletedId: String(deleted._id) };
  }

  /** 停用 / 啟用(守 `demo.sample-two.edit`,見該 input 的註解)。 */
  async setEnabled(
    operator: OperatorContext,
    input: SetDemoItemTwoEnabledInput,
  ): Promise<DemoItemTwoModel> {
    const current = await this.mustFind(operator, input.id);
    const updated = await this.items.updateById(operator, current._id, {
      $set: { enabled: input.enabled },
    });
    if (!updated) {
      throw notFoundError(`demo item two not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.toggleEnabled,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before: { enabled: current.enabled },
      after: { enabled: updated.enabled },
    });
    return this.decorateOne(operator, updated);
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<ItemRecord> {
    const found = await this.items.findById(operator, toObjectId(id, "id"));
    if (!found) {
      throw notFoundError(`demo item two not found: ${id}`);
    }
    return found;
  }

  /** 一次算好 abilities 與建立者,避免每一列各查一次(清單 N+1)。 */
  private async decorate(
    operator: OperatorContext,
    documents: ItemRecord[],
  ): Promise<DemoItemTwoModel[]> {
    const abilities = await this.abilitiesOf(operator);
    const creators = await this.loadCreators(operator, documents);
    return documents.map((document) => toModel(document, abilities, creators));
  }

  private async decorateOne(
    operator: OperatorContext,
    document: ItemRecord,
  ): Promise<DemoItemTwoModel> {
    const [model] = await this.decorate(operator, [document]);
    if (!model) {
      throw notFoundError(`demo item two not found: ${String(document._id)}`);
    }
    return model;
  }

  /**
   * 「這位操作者能編輯 / 刪除嗎」= 純權限判斷(同層 wildcard 的語意與 `PermissionGuard` 一致)。
   * 示範模組2 沒有種類規則,所以整份清單共用同一組答案。
   */
  private async abilitiesOf(
    operator: OperatorContext,
  ): Promise<DemoItemTwoAbilitiesModel> {
    if (!operator.actorId) {
      // 防呆:全域 AuthGuard 已擋掉未登入,走不到這裡
      return { canEdit: false, canDelete: false };
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return {
      canEdit: holdsPermission(resolution, PERMISSION.edit),
      canDelete: holdsPermission(resolution, PERMISSION.delete),
    };
  }

  /** 建立者的 id → 使用者文件;查不到的(示範資料的假 id、已刪的帳號)不會出現在 Map 裡。 */
  private async loadCreators(
    operator: OperatorContext,
    documents: ItemRecord[],
  ): Promise<Map<string, UserRecord>> {
    const ids = [
      ...new Set(
        documents
          .map((document) => document.createdBy)
          .filter((id) => id !== null)
          .map(String),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    const found = await this.users.findMany(operator, {
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    return new Map(found.map((user) => [String(user._id), user]));
  }
}

function toModel(
  document: ItemRecord,
  abilities: DemoItemTwoAbilitiesModel,
  creators: Map<string, UserRecord>,
): DemoItemTwoModel {
  const creator =
    document.createdBy === null
      ? undefined
      : creators.get(String(document.createdBy));
  return {
    id: String(document._id),
    name: document.name,
    note: document.note ?? null,
    enabled: document.enabled,
    createdBy: creator ? { id: String(creator._id), name: creator.name } : null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    abilities,
  };
}
