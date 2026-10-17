import { Injectable } from "@nestjs/common";

import {
  type ArrayColumnDef,
  type FieldDef,
  type LookupSourceDescriptor,
  type Prefill,
  arrayColumnsOf,
  filterScalarForField,
  lookupLabelFieldsOf,
  resolveLookupSource,
} from "@repo/domain/form";

import { FormVersionsRepository } from "../../database/database.module";
import { fieldGateOf, requiredShowKeys } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../form-access.service";
import { FORMS_PERMISSIONS } from "../form-permission-keys";
import { forbiddenError, notFoundError, validationError } from "../forms-error";
import {
  LookupProvidersService,
  type LookupRecord,
  lookupDisplayLabelOf,
  lookupValueOf,
} from "../lookup-providers";
import {
  DEFAULT_PAGE_SIZE,
  type FormLookupInput,
  type FormLookupRecordInput,
  type FormLookupTargetInput,
  MAX_PAGE_SIZE,
} from "./dto/form-runtime.input";
import type {
  FormLookupPayload,
  FormLookupRecord,
} from "./models/form-submission.model";

/** 從版本定義解析出來的查詢:來源描述、值欄、要回的來源欄位(帶入規則的 mapping)。 */
interface ResolvedTarget {
  source: LookupSourceDescriptor;
  valueField: string;
  /** 帶入規則要的來源欄位;選項 / 引用為空。 */
  mappedFields: string[];
}

/**
 * 目標欄位 key 的擁有者:一般欄位就是自己;明細引用子欄的路徑 `<明細 key>.<子欄 key>` → 明細欄
 * (子欄的權限繼承整個明細欄)。
 */
function ownerKeyOf(fieldKey: string): string {
  const dot = fieldKey.indexOf(".");
  return dot === -1 ? fieldKey : fieldKey.slice(0, dot);
}

/** 目標欄位:一般欄位照 key 找;`<明細 key>.<子欄 key>` 找明細欄裡的引用子欄。 */
function targetFieldOf(
  fields: readonly FieldDef[],
  fieldKey: string,
): FieldDef | undefined {
  const ownerKey = ownerKeyOf(fieldKey);
  const owner = fields.find((candidate) => candidate.key === ownerKey);
  if (ownerKey === fieldKey) {
    return owner;
  }
  if (owner?.type !== "array") {
    return undefined;
  }
  const columnKey = fieldKey.slice(ownerKey.length + 1);
  const column = arrayColumnsOf(owner).find(
    (candidate) =>
      candidate.key === columnKey && candidate.type === "reference",
  );
  return column ? { ...column, key: fieldKey } : undefined;
}

function targetOf(
  fields: readonly FieldDef[],
  prefills: readonly Prefill[],
  target: FormLookupTargetInput,
): ResolvedTarget {
  const hasField = target.fieldKey !== undefined && target.fieldKey !== null;
  const hasPrefill =
    target.prefillIndex !== undefined && target.prefillIndex !== null;
  if (hasField === hasPrefill) {
    throw validationError(
      "target needs exactly one of fieldKey / prefillIndex",
      ["target"],
    );
  }
  if (hasField) {
    const field = targetFieldOf(fields, target.fieldKey ?? "");
    if (field?.options?.kind === "lookup") {
      return {
        source: field.options.source,
        valueField: field.options.source.valueField ?? "id",
        mappedFields: [],
      };
    }
    if (field?.type === "reference" && field.source) {
      return {
        source: field.source,
        valueField: "id",
        // 明細引用子欄的列內帶入(B2c):回對應表要的來源欄位,前端帶進同一列
        mappedFields:
          (field as ArrayColumnDef).prefill?.mapping.map(
            (mapping) => mapping.sourceField,
          ) ?? [],
      };
    }
    throw validationError(
      `Field ${String(target.fieldKey)} has no lookup source`,
      ["target"],
    );
  }
  const prefill = prefills[target.prefillIndex ?? -1];
  if (!prefill) {
    throw validationError(
      `Prefill ${String(target.prefillIndex)} does not exist`,
      ["target"],
    );
  }
  return {
    source: prefill.source,
    valueField: prefill.source.valueField ?? "id",
    mappedFields: prefill.mapping.map((mapping) => mapping.sourceField),
  };
}

/**
 * `formLookup` / `formLookupRecord`(Spec 6a §5「lookup 來源」):前端只帶
 * `{ formKey, version, target }` + 關鍵字,**provider 與 `filter` 從版本定義取**,前端改不了;
 * 目標可以是明細的引用子欄(`fieldKey = "<明細 key>.<子欄 key>"`,權限看整個明細欄);
 * 再套操作者的可見範圍與欄位權限(`lookup-providers.ts`)。
 */
@Injectable()
export class FormLookupService {
  constructor(
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly providers: LookupProvidersService,
  ) {}

  async search(
    facts: FormOperatorFacts,
    input: FormLookupInput,
  ): Promise<FormLookupPayload> {
    const target = await this.resolve(facts, input);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    if (target === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const result = await this.providers.search(
      facts,
      target.source,
      { keyword: input.keyword ?? null, page, pageSize },
      this.requestedFields(target),
    );
    return {
      items: result.items.map((record) => this.toRecord(record, target)),
      totalCount: result.totalCount,
      page,
      pageSize,
    };
  }

  async record(
    facts: FormOperatorFacts,
    input: FormLookupRecordInput,
  ): Promise<FormLookupRecord | null> {
    const target = await this.resolve(facts, input);
    if (target === null) {
      return null;
    }
    const [record] = await this.providers.findByValues(
      facts,
      target.source,
      "id",
      [input.id],
      this.requestedFields(target),
    );
    return record ? this.toRecord(record, target) : null;
  }

  /**
   * 讀版本定義並解析目標。已發布 / 退役版:要有這張表單的新增資格(`canCreateWithForm`)或模組 `edit`(填寫中才會查),
   * 目標是欄位時還要讀得到那一欄(欄位級 `show`,含依賴鏈);
   * 草稿(`version` 省略):設計器預覽,要表單管理的檢視且讀得到這張表單。
   */
  private async resolve(
    facts: FormOperatorFacts,
    input: {
      formKey: string;
      version?: number | null;
      target: FormLookupTargetInput;
      filterValues?: Record<string, unknown> | null;
    },
  ): Promise<ResolvedTarget | null> {
    const isDraft = input.version === null || input.version === undefined;
    if (isDraft) {
      if (!this.access.has(facts, FORMS_PERMISSIONS.view)) {
        throw forbiddenError(`Missing permission ${FORMS_PERMISSIONS.view}`);
      }
      await this.access.requireReadableForm(facts, input.formKey);
    }
    const form = await this.access.findRuntimeForm(facts, input.formKey);
    if (!form) {
      throw notFoundError(`Form not found: ${input.formKey}`);
    }
    if (!isDraft) {
      const canFill =
        this.access.canCreateWithForm(facts, form.moduleKey, form.key) ||
        this.access.has(facts, `${form.moduleKey}.edit`);
      if (!canFill) {
        throw forbiddenError(`Missing permission ${form.moduleKey}.create`);
      }
    }
    const version = await this.versions.findOne(
      facts.operator,
      isDraft
        ? { formKey: form.key, status: "draft" }
        : {
            formKey: form.key,
            version: input.version,
            status: { $in: ["published", "retired"] },
          },
    );
    if (!version) {
      throw notFoundError(
        `Form version not found: ${form.key}@${String(input.version ?? "draft")}`,
      );
    }
    const fieldKey = input.target.fieldKey;
    // 讀不到這一欄(受保護沒有 show)的人不給候選資料;先於「有沒有 lookup 來源」判,
    // 否則能從錯誤碼的差別推出這欄的定義(骨架省略了 `options` / `source`)。
    // 明細子欄(`<明細 key>.<子欄 key>`)看整個明細欄的權限
    const ownerKey =
      fieldKey === undefined || fieldKey === null ? null : ownerKeyOf(fieldKey);
    if (
      !isDraft &&
      ownerKey !== null &&
      version.fields.some((candidate) => candidate.key === ownerKey) &&
      !fieldGateOf(facts, form.moduleKey, form.key).canShow(
        version.fields,
        ownerKey,
      )
    ) {
      throw forbiddenError(
        `Missing field permission: ${requiredShowKeys(version.fields, ownerKey).join(", ")}`,
      );
    }
    const target = targetOf(version.fields, version.prefills, input.target);
    // 連動篩選(B2d):換成前端送的目前值,只當縮小範圍的條件;被引用欄位沒有值 → 查無
    // 值依被引用欄位的型別收,型別不符當沒填(查無),不讓竄改的值撞上文件欄位的型別
    const source = resolveLookupSource(target.source, (fieldKey) =>
      filterScalarForField(
        version.fields.find((field) => field.key === fieldKey),
        input.filterValues?.[fieldKey],
      ),
    );
    return source === null ? null : { ...target, source };
  }

  private requestedFields(target: ResolvedTarget): string[] {
    return [
      ...new Set([
        ...lookupLabelFieldsOf(target.source),
        target.valueField,
        ...target.mappedFields,
      ]),
    ];
  }

  private toRecord(
    record: LookupRecord,
    target: ResolvedTarget,
  ): FormLookupRecord {
    const value = lookupValueOf(record, target.valueField);
    const values: Record<string, unknown> = {};
    for (const field of target.mappedFields) {
      if (field === "id") {
        values.id = record.id;
      } else if (field in record.values) {
        // 受保護且無權的欄位在 provider 就被省略了:這裡照樣省略(前端顯示「—」)
        values[field] = record.values[field];
      }
    }
    return {
      id: record.id,
      value:
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : null,
      // 顯示模板在後端組好(日期已依讀者租戶時區格式化、選項用 label);沒模板用 labelField
      label: lookupDisplayLabelOf(record, target.source),
      values,
    };
  }
}
