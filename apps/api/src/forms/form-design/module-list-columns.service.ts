import { Injectable } from "@nestjs/common";

import {
  LIST_BUILTIN_COLUMNS,
  type ListBuiltinColumn,
  type ListBuiltinColumns,
  isValidFieldKey,
  listBuiltinColumnsOf,
} from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import {
  FormVersionsRepository,
  FormsRepository,
  ModulesRepository,
} from "../../database/database.module";
import { requiredShowKeys } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../form-access.service";
import {
  FORM_VALIDATION_REASONS,
  forbiddenError,
  validationError,
} from "../forms-error";
import {
  LIST_SLOT_KEYS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type ModuleListColumn,
  ModuleListColumnKind,
  type ModuleListColumnsPayload,
  type SetModuleListColumnsInput,
} from "./module-list-columns";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 存在 `modules.settings.list.columns` 的一筆(落庫形狀,kind 是小寫字串)。 */
interface StoredColumn {
  kind: "slot" | "field";
  key: string;
  formKey?: string | null;
  width: number;
  order: number;
}

/**
 * 列表欄位配置(`modules.settings.list`;見 `docs/modules/forms.md`「列表欄位配置」):root 改全域預設。
 *
 * 寫入時驗:摘要槽 key 合法;表單欄位存在於該模組**共用表單**的目前版本、而且在那些版本裡都
 * **不是受保護欄位**(受保護欄位不可當列表欄 —— 列表對每個人顯示同一組欄)。
 * 讀取給表單模組的使用者(有該模組任一個個別權限)。
 */
@Injectable()
export class ModuleListColumnsService {
  constructor(
    private readonly modules: ModulesRepository,
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly audit: AuditService,
  ) {}

  async get(
    facts: FormOperatorFacts,
    moduleKey: string,
  ): Promise<ModuleListColumnsPayload> {
    const module = await this.access.requireFormModule(
      facts.operator,
      moduleKey,
    );
    this.access.assertRuntimeAccess(facts, moduleKey);
    return {
      moduleKey,
      columns: columnsOf(module.settings),
      builtin: builtinOf(module.settings),
    };
  }

  async set(
    facts: FormOperatorFacts,
    input: SetModuleListColumnsInput,
  ): Promise<ModuleListColumnsPayload> {
    if (!facts.isRoot) {
      throw forbiddenError(
        "List columns are configured from the root org",
        "ROOT_ONLY",
      );
    }
    const module = await this.access.requireFormModule(
      facts.operator,
      input.moduleKey,
    );
    const catalog = await this.fieldCatalog(facts, input.moduleKey);
    const seen = new Set<string>();
    const stored: StoredColumn[] = input.columns.map((column, index) => {
      const path = `columns.${String(index)}`;
      const identity = `${column.kind}:${column.formKey ?? ""}:${column.key}`;
      if (seen.has(identity)) {
        throw validationError(
          `Duplicate list column ${identity}`,
          [path],
          FORM_VALIDATION_REASONS.listColumnDuplicate,
        );
      }
      seen.add(identity);
      if (
        !Number.isInteger(column.width) ||
        column.width < MIN_COLUMN_WIDTH ||
        column.width > MAX_COLUMN_WIDTH
      ) {
        throw validationError(
          `width must be ${String(MIN_COLUMN_WIDTH)}-${String(MAX_COLUMN_WIDTH)}`,
          [path],
        );
      }
      if (column.kind === ModuleListColumnKind.SLOT) {
        if (!(LIST_SLOT_KEYS as readonly string[]).includes(column.key)) {
          throw validationError(
            `Unknown summary slot ${column.key}`,
            [path],
            FORM_VALIDATION_REASONS.listColumnUnavailable,
          );
        }
        return {
          kind: "slot",
          key: column.key,
          width: column.width,
          order: column.order,
        };
      }
      this.assertListableField(catalog, column.key, column.formKey, path);
      return {
        kind: "field",
        key: column.key,
        formKey: column.formKey ?? null,
        width: column.width,
        order: column.order,
      };
    });
    const before = columnsOf(module.settings);
    const beforeBuiltin = builtinOf(module.settings);
    const builtin = storedBuiltinOf(input.builtin, beforeBuiltin);
    await this.modules.updateById(facts.operator, module._id, {
      $set: { "settings.list": { columns: stored, builtin } },
    });
    await this.audit.record(facts.operator, {
      action: "module.set-list-columns",
      targetType: "module",
      targetId: module._id,
      before: { columns: before, builtin: beforeBuiltin },
      after: { columns: stored, builtin },
    });
    return {
      moduleKey: input.moduleKey,
      columns: columnsOf({ list: { columns: stored } }),
      builtin,
    };
  }

  /** 表單 key → 目前版本的欄位 key → 是否受保護(只看共用表單的目前版本)。 */
  private async fieldCatalog(
    facts: FormOperatorFacts,
    moduleKey: string,
  ): Promise<Map<string, Map<string, boolean>>> {
    const forms = await this.forms.findMany(facts.operator, {
      moduleKey,
      ownerOrgId: null,
      currentVersion: { $ne: null },
    });
    const catalog = new Map<string, Map<string, boolean>>();
    for (const form of forms) {
      const version = await this.versions.findOne(facts.operator, {
        formKey: form.key,
        version: form.currentVersion,
      });
      const fields = version?.fields ?? [];
      // 明細欄不能當列表欄(列表只顯示單值),目錄裡不列 —— 送來就是「不在目前版本」
      catalog.set(
        form.key,
        new Map(
          fields
            .filter((field) => field.type !== "array")
            .map((field) => [
              field.key,
              requiredShowKeys(fields, field.key).length > 0,
            ]),
        ),
      );
    }
    return catalog;
  }

  private assertListableField(
    catalog: ReadonlyMap<string, ReadonlyMap<string, boolean>>,
    key: string,
    formKey: string | null | undefined,
    path: string,
  ): void {
    if (!isValidFieldKey(key)) {
      throw validationError(`Invalid field key ${key}`, [path]);
    }
    const scoped =
      formKey === null || formKey === undefined
        ? [...catalog.values()]
        : [catalog.get(formKey)].filter(
            (fields): fields is ReadonlyMap<string, boolean> =>
              fields !== undefined,
          );
    const declaring = scoped.filter((fields) => fields.has(key));
    if (declaring.length === 0) {
      throw validationError(
        `Field ${key} is not in the current version of any form of this module`,
        [path],
        FORM_VALIDATION_REASONS.listColumnUnavailable,
      );
    }
    if (declaring.some((fields) => fields.get(key) === true)) {
      throw validationError(
        `Field ${key} is protected and cannot be a list column`,
        [path],
        FORM_VALIDATION_REASONS.listColumnProtected,
      );
    }
  }
}

/** `modules.settings.list.builtin` → 三個開關(沒存過 / 不認得的鍵 = 顯示)。 */
function builtinOf(settings: Record<string, unknown>): ListBuiltinColumns {
  const list = settings.list;
  return listBuiltinColumnsOf(isRecord(list) ? list.builtin : undefined);
}

/**
 * 要存的內建欄開關:缺席 / null = 保留目前的;有給就三個鍵都要是 boolean
 * (GraphQL 型別已保證,這裡再守一次落庫形狀)。
 */
function storedBuiltinOf(
  input: Partial<Record<ListBuiltinColumn, unknown>> | null | undefined,
  current: ListBuiltinColumns,
): ListBuiltinColumns {
  if (input === null || input === undefined) {
    return current;
  }
  const next = { ...current };
  for (const column of LIST_BUILTIN_COLUMNS) {
    const value = input[column];
    if (typeof value !== "boolean") {
      throw validationError(`builtin.${column} must be a boolean`, [
        `builtin.${column}`,
      ]);
    }
    next[column] = value;
  }
  return next;
}

/** `modules.settings.list.columns` → 對外形狀(不認得的項目略過),依 order 排。 */
function columnsOf(settings: Record<string, unknown>): ModuleListColumn[] {
  const list = settings.list;
  const raw = isRecord(list) && Array.isArray(list.columns) ? list.columns : [];
  return raw
    .filter(
      (item): item is StoredColumn =>
        isRecord(item) &&
        (item.kind === "slot" || item.kind === "field") &&
        typeof item.key === "string" &&
        typeof item.width === "number" &&
        typeof item.order === "number",
    )
    .map((item) => ({
      kind:
        item.kind === "slot"
          ? ModuleListColumnKind.SLOT
          : ModuleListColumnKind.FIELD,
      key: item.key,
      formKey: typeof item.formKey === "string" ? item.formKey : null,
      width: item.width,
      order: item.order,
    }))
    .toSorted((a, b) => a.order - b.order);
}
