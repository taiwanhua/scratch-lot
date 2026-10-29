import { Injectable } from "@nestjs/common";

import {
  LIST_BUILTIN_COLUMNS,
  LIST_TEMPLATE_LABEL_MAX_LENGTH,
  LIST_TEMPLATE_MAX_LENGTH,
  type ListBuiltinColumn,
  type ListBuiltinColumns,
  isListSlotKey,
  isValidFieldKey,
  listBuiltinColumnsOf,
  listTemplatePlaceholdersOf,
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
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type ModuleListColumn,
  type ModuleListColumnInput,
  ModuleListColumnKind,
  type ModuleListColumnsPayload,
  type SetModuleListColumnsInput,
} from "./module-list-columns";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 存在 `modules.settings.list.columns` 的一筆(落庫形狀,kind 是小寫字串)。 */
interface StoredColumn {
  kind: "slot" | "field" | "template";
  /** 摘要槽 key、欄位 key,或組合欄的模板 */
  key: string;
  formKey?: string | null;
  /** 只有組合欄:欄名 */
  label?: string;
  width: number;
  order: number;
}

const STORED_KINDS: Record<StoredColumn["kind"], ModuleListColumnKind> = {
  slot: ModuleListColumnKind.SLOT,
  field: ModuleListColumnKind.FIELD,
  template: ModuleListColumnKind.TEMPLATE,
};

/** 表單 key → 目前版本的欄位 key → 是否受保護。 */
type FieldCatalog = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

/**
 * 列表欄位配置(`modules.settings.list`;見 `docs/modules/forms.md`「列表欄位配置」):root 改全域預設。
 *
 * 寫入時驗:摘要槽 key 合法;表單欄位存在於該模組**共用表單**的目前版本、而且在那些版本裡都
 * **不是受保護欄位**(受保護欄位不可當列表欄 —— 列表對每個人顯示同一組欄);組合欄的欄名必填、
 * 模板至少一個佔位符且每個佔位符都是槽或照表單欄位同一套規則可列的欄位(受保護欄位不能透過組合欄露出)。
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
      const key =
        column.kind === ModuleListColumnKind.TEMPLATE
          ? column.key.trim()
          : column.key;
      const identity = `${column.kind}:${column.formKey ?? ""}:${key}`;
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
      if (column.kind === ModuleListColumnKind.TEMPLATE) {
        return this.templateColumnOf(catalog, column, key, path);
      }
      if (column.kind === ModuleListColumnKind.SLOT) {
        if (!isListSlotKey(column.key)) {
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
  ): Promise<FieldCatalog> {
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

  /**
   * 組合欄:欄名必填(1–50 字)、模板 1–200 字且至少一個佔位符(格式錯,沒有 reason,定位到 `.label` / `.template`);
   * 佔位符是槽(`isListSlotKey`)或表單欄位 —— 欄位照表單欄位欄同一套規則(存在於目前版本、不是受保護欄位,
   * `formKey` 給了就只看那一張),錯了帶 reason 定位到整欄。
   */
  private templateColumnOf(
    catalog: FieldCatalog,
    column: ModuleListColumnInput,
    template: string,
    path: string,
  ): StoredColumn {
    const label = (column.label ?? "").trim();
    if (label === "" || label.length > LIST_TEMPLATE_LABEL_MAX_LENGTH) {
      throw validationError(
        `label must be 1-${String(LIST_TEMPLATE_LABEL_MAX_LENGTH)} characters`,
        [`${path}.label`],
      );
    }
    const placeholders = listTemplatePlaceholdersOf(template);
    if (
      template.length > LIST_TEMPLATE_MAX_LENGTH ||
      placeholders.length === 0 ||
      placeholders.some((placeholder) => placeholder.kind === "invalid")
    ) {
      throw validationError(
        `template must be at most ${String(LIST_TEMPLATE_MAX_LENGTH)} characters with known placeholders`,
        [`${path}.template`],
      );
    }
    const formKey = column.formKey ?? null;
    if (formKey !== null && !catalog.has(formKey)) {
      throw validationError(
        `Form ${formKey} is not a shared form of this module`,
        [path],
        FORM_VALIDATION_REASONS.listColumnUnavailable,
      );
    }
    for (const placeholder of placeholders) {
      if (placeholder.kind === "field") {
        this.assertListableField(
          catalog,
          placeholder.key,
          column.formKey,
          path,
        );
      }
    }
    return {
      kind: "template",
      key: template,
      formKey,
      label,
      width: column.width,
      order: column.order,
    };
  }

  private assertListableField(
    catalog: FieldCatalog,
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
        typeof item.kind === "string" &&
        Object.hasOwn(STORED_KINDS, item.kind) &&
        typeof item.key === "string" &&
        typeof item.width === "number" &&
        typeof item.order === "number",
    )
    .map((item) => ({
      kind: STORED_KINDS[item.kind],
      key: item.key,
      formKey: typeof item.formKey === "string" ? item.formKey : null,
      label:
        item.kind === "template" && typeof item.label === "string"
          ? item.label
          : null,
      width: item.width,
      order: item.order,
    }))
    .toSorted((a, b) => a.order - b.order);
}
