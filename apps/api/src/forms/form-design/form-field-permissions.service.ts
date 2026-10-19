import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import type { Persisted } from "../../database/base.repository";
import {
  FormVersionsRepository,
  FormsRepository,
  ModulesRepository,
  type PermissionDocument,
  PermissionsRepository,
} from "../../database/database.module";
import {
  type FormSubmissionUsage,
  FormSubmissionUsageCounter,
} from "../../database/form-submission-usage";
import type { OperatorContext } from "../../database/operator-context";
import { RelationService } from "../../database/relation.service";
import { type FormRecord, escapeRegex } from "../form-access.service";
import {
  type FieldPermissionAction,
  type ParsedFieldPermissionKey,
  fieldPermissionKey,
  fieldPermissionName,
  fieldPermissionPrefix,
  formCreatePermissionKey,
  formCreatePermissionName,
  parseFieldPermissionKey,
} from "../form-permission-keys";
import { notFoundError, permissionNotDeletableError } from "../forms-error";
import type { DeleteRetiredPermissionInput } from "./dto/form-design.input";
import { FormPublishHooks } from "./form-publish-hooks";
import type {
  DeleteRetiredPermissionPayload,
  RetiredFormPermission,
  RetiredFormPermissionsPayload,
} from "./models/form.model";

type PermissionRecord = Persisted<PermissionDocument>;

/** 稽核動作名(`docs/modules/forms.md`「稽核」)。 */
export const PERMISSION_AUDIT = {
  deleteRetired: "permission.delete-retired",
} as const;

/** 一版宣告的欄位級權限:key → 顯示名。 */
function desiredPermissionsOf(
  form: FormRecord,
  fields: readonly FieldDef[],
): Map<string, string> {
  const desired = new Map<string, string>();
  for (const field of fields) {
    for (const action of ["show", "edit"] as const) {
      if (field.permission?.[action] === true) {
        desired.set(
          fieldPermissionKey(form.moduleKey, action, form.key, field.key),
          fieldPermissionName(form.name, field.label, action),
        );
      }
    }
  }
  return desired;
}

/** 發布步驟 3 這次新建的依表單新增權限;發布成功畫面提示「到角色管理授予」用。 */
export interface CreatedFormCreatePermission {
  key: string;
  name: string;
}

/** 一筆宣告權限這次的寫入結果。 */
type DeclareOutcome = "created" | "updated" | "unchanged";

/**
 * 表單動態權限(`permissions.source = "dynamic"`):
 * - 發布步驟 3 的同步(`syncForVersion`):欄位級權限缺的建、有 `retiredAt` 的復活、不再宣告的退役、`name` 隨 label;
 *   模組開啟依表單分開新增權限(`perFormCreate`)時再確保 `<模組>.create-<formKey>`(名稱「<表單名> 新增」隨表單改名;不退役,
 *   不自動授予任何角色)
 * - 「模組與權限」頁的退役權限清理(`retired` / `deleteRetired`):三層檢查
 */
@Injectable()
export class FormFieldPermissionsService {
  constructor(
    private readonly permissions: PermissionsRepository,
    private readonly modules: ModulesRepository,
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly relations: RelationService,
    private readonly usage: FormSubmissionUsageCounter,
    private readonly audit: AuditService,
    private readonly hooks: FormPublishHooks,
  ) {}

  /**
   * 發布步驟 3(在發布的交易內執行)。每一筆寫入都先看「已經是目標狀態就跳過」(重試發布接續舊資料時也一樣);
   * 同 key 欄位跨版本沿用同一筆權限(`_id` 不變,角色的授予跟著留下)。
   * 回傳這次**新建**的依表單新增權限(已存在、或模組沒開 → null)。
   */
  async syncForVersion(
    operator: OperatorContext,
    form: FormRecord,
    fields: readonly FieldDef[],
  ): Promise<CreatedFormCreatePermission | null> {
    const module = await this.modules.findOne(operator, {
      key: form.moduleKey,
    });
    if (!module) {
      throw new Error(`表單模組 ${form.moduleKey} 不存在(seed 未跑?)`);
    }
    const desired = desiredPermissionsOf(form, fields);
    const existing = await this.permissions.findMany(operator, {
      key: { $regex: this.formKeyPattern(form) },
    });
    const byKey = new Map(existing.map((record) => [record.key, record]));

    for (const [key, name] of desired) {
      await this.ensureDeclared(
        operator,
        module._id,
        key,
        name,
        byKey.get(key),
      );
    }
    for (const record of existing) {
      if (
        record.source === "dynamic" &&
        !desired.has(record.key) &&
        record.retiredAt === null
      ) {
        await this.hooks.reached("retire-permission");
        await this.permissions.updateById(operator, record._id, {
          $set: { retiredAt: new Date() },
        });
      }
    }
    return module.perFormCreate
      ? this.syncCreatePermission(operator, module._id, form)
      : null;
  }

  /**
   * 依表單新增權限:缺的建、`name` 隨表單名稱。表單不能刪,所以不退役;
   * 欄位級權限的退役與清理只認 `show-` / `edit-`(`parseFieldPermissionKey`),碰不到它。
   */
  private async syncCreatePermission(
    operator: OperatorContext,
    moduleId: Types.ObjectId,
    form: FormRecord,
  ): Promise<CreatedFormCreatePermission | null> {
    const key = formCreatePermissionKey(form.moduleKey, form.key);
    const name = formCreatePermissionName(form.name);
    const current = await this.permissions.findOne(operator, { key });
    const outcome = await this.ensureDeclared(
      operator,
      moduleId,
      key,
      name,
      current ?? undefined,
    );
    return outcome === "created" ? { key, name } : null;
  }

  /** 一筆這一版宣告的權限:缺的建、退役的復活、`name` 不同的改;已是目標狀態就跳過。 */
  private async ensureDeclared(
    operator: OperatorContext,
    moduleId: Types.ObjectId,
    key: string,
    name: string,
    current: PermissionRecord | undefined,
  ): Promise<DeclareOutcome> {
    // 形狀上撞到手寫的 seed 權限(不該發生):不碰 seed 的資料
    if (current?.source === "seed") {
      return "unchanged";
    }
    if (current?.retiredAt === null && current.name === name) {
      return "unchanged";
    }
    await this.hooks.reached("permission");
    if (current) {
      await this.permissions.updateById(operator, current._id, {
        $set: { retiredAt: null, name },
      });
      return "updated";
    }
    // `current` 是同一個交易裡先查的結果(發布是一個交易,TX-04):沒有才建;
    // 同時有別的發布建了同一筆 → 唯一索引擋下,錯誤往外拋、整個發布回復
    await this.permissions.create(operator, {
      key,
      moduleId,
      name,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "dynamic",
      retiredAt: null,
    });
    return "created";
  }

  /** 這張表單兩種動作的 key 前綴(formKey 不含 `-`,前綴不會誤中別張表單)。 */
  private formKeyPattern(form: FormRecord): string {
    const prefixes = (["show", "edit"] as const).map((action) =>
      escapeRegex(fieldPermissionPrefix(form.moduleKey, action, form.key)),
    );
    return `^(${prefixes.join("|")})`;
  }

  // ---- 退役權限清理(「模組與權限」頁,根組織專屬)----

  async retired(
    operator: OperatorContext,
  ): Promise<RetiredFormPermissionsPayload> {
    const records = await this.permissions.findMany(
      operator,
      { source: "dynamic", retiredAt: { $ne: null } },
      { sort: { key: 1 } },
    );
    const items: RetiredFormPermission[] = [];
    const formNames = new Map<string, string | null>();
    for (const record of records) {
      const parsed = parseFieldPermissionKey(record.key);
      if (!parsed || record.retiredAt === null) {
        continue;
      }
      if (!formNames.has(parsed.formKey)) {
        const form = await this.forms.findOne(operator, {
          key: parsed.formKey,
        });
        formNames.set(parsed.formKey, form?.name ?? null);
      }
      items.push({
        key: record.key,
        name: record.name,
        moduleKey: parsed.moduleKey,
        formKey: parsed.formKey,
        formName: formNames.get(parsed.formKey) ?? null,
        fieldKey: parsed.fieldKey,
        action: parsed.action,
        retiredAt: record.retiredAt,
        usage: await this.usageOf(operator, parsed),
      });
    }
    return { items, totalCount: items.length };
  }

  /**
   * 刪除一筆退役的欄位級權限,不自動刪:
   * 1. 有草稿(6b 起含審核中)的提交綁的版本仍宣告該欄位 → 擋下,回筆數與版本
   * 2. 只剩已完成的提交用到 → 要 `confirmCompletedUsage` 才刪(刪後這些單的該欄位只有 root 看得到)
   * 3. 沒有任何提交用到 → 直接刪
   * 刪 = 權限列與全部 `role_permission` 綁定一起抹掉(硬刪:權限 key 唯一,軟刪的殭屍會擋住
   * 日後同一欄位重新發布時建回同一個 key),並寫稽核。
   */
  async deleteRetired(
    operator: OperatorContext,
    input: DeleteRetiredPermissionInput,
  ): Promise<DeleteRetiredPermissionPayload> {
    const record = await this.permissions.findOne(operator, {
      key: input.permissionKey,
    });
    if (!record) {
      throw notFoundError(`Permission not found: ${input.permissionKey}`);
    }
    const parsed = parseFieldPermissionKey(record.key);
    if (record.source !== "dynamic" || !parsed) {
      throw permissionNotDeletableError(
        `Permission ${record.key} is not a form field permission`,
        ["NOT_DYNAMIC"],
      );
    }
    if (record.retiredAt === null) {
      throw permissionNotDeletableError(
        `Permission ${record.key} is still declared by the current version`,
        ["NOT_RETIRED"],
      );
    }
    const usage = await this.usageOf(operator, parsed);
    if (usage.draftCount > 0) {
      throw permissionNotDeletableError(
        `Permission ${record.key} is used by ${String(usage.draftCount)} draft submission(s)`,
        ["USED_BY_DRAFTS"],
        { usage },
      );
    }
    if (usage.completedCount > 0 && input.confirmCompletedUsage !== true) {
      throw permissionNotDeletableError(
        `Permission ${record.key} is used by ${String(usage.completedCount)} completed submission(s); confirm to delete`,
        ["CONFIRM_REQUIRED"],
        { usage },
      );
    }
    const links = await this.relations.listLinks("role_permission", {
      secondIds: [record._id],
    });
    // 順序:先寫稽核 → 刪權限列 → 解綁。每一步重做都無害(刪不到就是已刪、解綁照差集);
    // 中途失敗時權限列可能已不在、綁定還在 —— 解析權限時只認存在的權限列,殘留的綁定不生效,
    // 下一次清理(或角色矩陣存檔)會把它們帶走,不會讓任何人多拿到權限。
    await this.audit.record(operator, {
      action: PERMISSION_AUDIT.deleteRetired,
      targetType: "permission",
      targetId: record._id,
      before: {
        key: record.key,
        name: record.name,
        roleCount: links.length,
        completedCount: usage.completedCount,
      },
    });
    await this.permissions.hardDeleteById(operator, record._id);
    await this.relations.unlinkMany(
      operator,
      links.map((link) => ({
        type: "role_permission" as const,
        firstId: link.firstId,
        secondId: link.secondId,
      })),
    );
    return { success: true, deletedKey: record.key, usage };
  }

  /** 宣告了這個欄位(且該動作為 true)的版本,被多少提交用到。 */
  private async usageOf(
    operator: OperatorContext,
    parsed: ParsedFieldPermissionKey,
  ): Promise<FormSubmissionUsage> {
    const versions = await this.versions.findMany(operator, {
      formKey: parsed.formKey,
      version: { $ne: null },
    });
    const declaring = versions
      .filter((version) =>
        version.fields.some(
          (field) =>
            field.key === parsed.fieldKey &&
            field.permission?.[
              parsed.action satisfies FieldPermissionAction
            ] === true,
        ),
      )
      .map((version) => version.version)
      .filter((version): version is number => version !== null);
    return this.usage.usageOf(parsed.formKey, declaring);
  }
}
