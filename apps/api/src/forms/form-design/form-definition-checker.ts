import { Injectable } from "@nestjs/common";

import {
  FORM_SUBMISSION_PROVIDER,
  type FieldDef,
  type FormDefinition,
  type LookupProviderRegistry,
  type LookupSourceDescriptor,
  type ValidationReport,
  arrayColumnsOf,
  hasLabelTemplate,
  lookupTemplateFieldOf,
  templatePlaceholdersOf,
  validateDefinition,
} from "@repo/domain/form";
import { recheckRegexSafety } from "@repo/domain/form-regex-safety";

import {
  FormVersionsRepository,
  ModulesRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { FieldCategoryOptionsService } from "../field-category-options.service";
import type { FormOperatorFacts, FormRecord } from "../form-access.service";
import { validationError } from "../forms-error";
import {
  LookupProvidersService,
  submissionCatalogOfFields,
} from "../lookup-providers";
import type { FormDefinitionInput } from "./dto/form-design.input";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `form_submission` 來源的顯示模板精確到「這張表單」:`{{value.<key>}}` 的 key 要在該表單目前版本的
 * 非受保護欄位內(登錄表是所有來源表單的聯集,domain 檢查器只驗到聯集;已報過的佔位符不重報)。
 */
function checkSubmissionTemplate(
  source: LookupSourceDescriptor,
  catalog: Readonly<Record<string, unknown>>,
  location: Record<string, unknown>,
  report: ValidationReport,
): void {
  if (!hasLabelTemplate(source)) {
    return;
  }
  for (const name of new Set(templatePlaceholdersOf(source.labelTemplate))) {
    const field = lookupTemplateFieldOf(source.provider, name);
    const reported = report.errors.some(
      (issue) =>
        issue.code === "LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER" &&
        issue.message.includes(`{{${name}}}`) &&
        issue.location.fieldKey === location.fieldKey &&
        issue.location.prefillIndex === location.prefillIndex,
    );
    if (field !== null && !(field in catalog) && !reported) {
      report.errors.push({
        code: "LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER",
        message: `表單 ${String(source.formKey)} 目前的版本沒有可用的欄位 ${field},顯示模板不能用 {{${name}}}`,
        location: {
          ...location,
          property: `${String(location.property)}.labelTemplate`,
        },
      });
    }
  }
}

/**
 * input 的四塊 → `FormDefinition`。只驗**最外層形狀**(GraphQL 已保證是物件 / 物件陣列;
 * `layout.sections` 要是陣列),細節全交給檢查器 —— 形狀不對的欄位由它報錯並定位。
 */
export function definitionOf(input: FormDefinitionInput): FormDefinition {
  if (!Array.isArray(input.layout.sections)) {
    throw validationError("layout.sections must be an array", ["layout"]);
  }
  return {
    fields: input.fields as unknown as FieldDef[],
    layout: input.layout as unknown as FormDefinition["layout"],
    summaryMap: input.summaryMap,
    prefills: input.prefills as unknown as FormDefinition["prefills"],
  };
}

/** 帶入規則的來源是這張表單自己(只有帶入規則的「自己」用草稿的欄位目錄)。 */
function isSelfPrefill(
  source: LookupSourceDescriptor,
  location: Record<string, unknown>,
  formKey: string,
): boolean {
  return (
    source.provider === FORM_SUBMISSION_PROVIDER &&
    source.formKey === formKey &&
    typeof location.prefillIndex === "number"
  );
}

/** 明細引用子欄的來源描述(定位到明細欄 + 子欄)。 */
function columnSourcesOf(
  field: FieldDef,
): { source: LookupSourceDescriptor; location: Record<string, unknown> }[] {
  return arrayColumnsOf(field).flatMap((column) =>
    column.type === "reference" && column.source
      ? [
          {
            source: column.source,
            location: {
              fieldKey: field.key,
              columnKey: column.key,
              property: "source",
            },
          },
        ]
      : [],
  );
}

/** 這個來源的帶入對應表:表單層帶入規則,或明細引用子欄的列內帶入;其他來源沒有。 */
function mappingOf(
  definition: FormDefinition,
  location: Record<string, unknown>,
): readonly { sourceField: string }[] {
  if (typeof location.prefillIndex === "number") {
    return definition.prefills[location.prefillIndex]?.mapping ?? [];
  }
  if (typeof location.columnKey !== "string") {
    return [];
  }
  const owner = definition.fields.find(
    (field) => isRecord(field) && field.key === location.fieldKey,
  );
  const column =
    owner === undefined
      ? undefined
      : arrayColumnsOf(owner).find(
          (candidate) => candidate.key === location.columnKey,
        );
  const mapping: unknown = column?.prefill?.mapping;
  return Array.isArray(mapping) ? (mapping as { sourceField: string }[]) : [];
}

/** 定義裡用到的所有 lookup 來源描述(選項、引用、明細引用子欄、帶入),附定位。 */
function sourcesOf(
  definition: FormDefinition,
): { source: LookupSourceDescriptor; location: Record<string, unknown> }[] {
  const found: {
    source: LookupSourceDescriptor;
    location: Record<string, unknown>;
  }[] = [];
  for (const field of definition.fields) {
    if (!isRecord(field)) {
      continue;
    }
    if (field.options?.kind === "lookup") {
      found.push({
        source: field.options.source,
        location: { fieldKey: field.key, property: "options.source" },
      });
    }
    if (field.type === "reference" && field.source) {
      found.push({
        source: field.source,
        location: { fieldKey: field.key, property: "source" },
      });
    }
    found.push(...columnSourcesOf(field));
  }
  for (const [prefillIndex, prefill] of definition.prefills.entries()) {
    if (isRecord(prefill) && isRecord(prefill.source)) {
      found.push({
        source: prefill.source,
        location: { prefillIndex, property: "source" },
      });
    }
  }
  return found;
}

/**
 * 定義檢查器的 api 端(`@repo/domain/form` 的 `validateDefinition` + 只有 api 知道的登錄表):
 * 已發布過的欄位型別、欄位管理類別、lookup 登錄表、列表欄位配置;另外把 `form_submission`
 * 來源的欄位精確到「那張表單目前版本有沒有這欄」(登錄表只給得出各來源表單的聯集)。
 * **帶入規則**的來源是這張表單自己(從本表單先前的提交帶入)時,欄位目錄用**這份草稿**的
 * 欄位,不看已發布版(可能還沒發布);執行時照一般規則以那筆提交綁的版本判斷。只限帶入:選項 / 引用來源
 * 指到自己照一般規則(目前已發布版的欄位目錄;還沒發布 = 只有摘要槽),因為它們在填寫時查的就是已發布版的提交。
 */
@Injectable()
export class FormDefinitionChecker {
  constructor(
    private readonly versions: FormVersionsRepository,
    private readonly modules: ModulesRepository,
    private readonly categories: FieldCategoryOptionsService,
    private readonly lookups: LookupProvidersService,
  ) {}

  async check(
    facts: FormOperatorFacts,
    // 只用到 key 與模組:還沒建立的表單(受管定義安裝的寫入前檢查)也能先驗
    form: Pick<FormRecord, "key" | "moduleKey">,
    definition: FormDefinition,
  ): Promise<ValidationReport> {
    const operator = facts.operator;
    const sources = sourcesOf(definition);
    const selfPrefill = (
      source: LookupSourceDescriptor,
      location: Record<string, unknown>,
    ) => isSelfPrefill(source, location, form.key);
    const submissionFormKeys = sources
      .filter(
        ({ source, location }) =>
          source.provider === FORM_SUBMISSION_PROVIDER &&
          source.formKey &&
          !selfPrefill(source, location),
      )
      .map(({ source }) => source.formKey ?? "");
    const hasSelfPrefill = sources.some(({ source, location }) =>
      selfPrefill(source, location),
    );
    const selfCatalog = hasSelfPrefill
      ? submissionCatalogOfFields(
          definition.fields.filter((field) => isRecord(field)),
        )
      : {};
    const [previousFields, fieldCategoryKeys, lookupProviders, listColumns] =
      await Promise.all([
        this.previousFieldsOf(operator, form.key),
        this.categories.categoryKeys(operator),
        this.lookups.registryFor(facts, submissionFormKeys),
        this.listColumnFieldKeys(operator, form),
      ]);
    const report = validateDefinition(definition, {
      regexSafety: recheckRegexSafety,
      previousFields,
      fieldCategoryKeys,
      lookupProviders: {
        ...lookupProviders,
        [FORM_SUBMISSION_PROVIDER]: {
          fields: {
            ...lookupProviders[FORM_SUBMISSION_PROVIDER]?.fields,
            ...selfCatalog,
          },
          // 表單提交來源沒有可當篩選的欄位(連動篩選一律擋下)
          filterFields: {},
        },
      },
      listColumnFieldKeys: listColumns,
    });
    await this.checkSubmissionSources(facts, definition, sources, report, {
      formKey: form.key,
      catalog: selfCatalog,
    });
    this.checkProjectValueFields(sources, lookupProviders, report);
    return report;
  }

  /**
   * 專案來源的值欄(非 `id`)只能是文字欄位:依值取回以字串等值比對文件欄位,
   * 數字 / 日期等型別的值存成別的型別,比對不到(底座的 user / org 可回欄位本來就都是文字)。
   */
  private checkProjectValueFields(
    sources: ReturnType<typeof sourcesOf>,
    registry: LookupProviderRegistry,
    report: ValidationReport,
  ): void {
    for (const { source, location } of sources) {
      const valueField = source.valueField ?? "id";
      const type = registry[source.provider]?.fields[valueField];
      if (
        valueField === "id" ||
        type === undefined ||
        type === "text" ||
        !this.lookups.isProjectSource(source.provider)
      ) {
        continue;
      }
      report.errors.push({
        code: "LOOKUP_UNKNOWN_FIELD",
        message: `lookup 來源 ${source.provider} 的值欄只能是 id 或文字欄位(${valueField} 是 ${type})`,
        location,
      });
    }
  }

  /** 已發布 / 退役過的每個欄位 key 最後一次的定義(同 key 改型別 → `KEY_TYPE_CHANGED`)。 */
  private async previousFieldsOf(
    operator: OperatorContext,
    formKey: string,
  ): Promise<FieldDef[]> {
    const published = await this.versions.findMany(
      operator,
      { formKey, status: { $in: ["published", "retired"] } },
      { sort: { version: 1 } },
    );
    const byKey = new Map<string, FieldDef>();
    for (const version of published) {
      for (const field of version.fields) {
        byKey.set(field.key, field);
      }
    }
    return [...byKey.values()];
  }

  /** `modules.settings.list.columns` 裡指到這張表單(或沒指定表單)的欄位 key。 */
  private async listColumnFieldKeys(
    operator: OperatorContext,
    form: Pick<FormRecord, "key" | "moduleKey">,
  ): Promise<string[]> {
    const module = await this.modules.findOne(operator, {
      key: form.moduleKey,
    });
    const list = module?.settings.list;
    const columns =
      isRecord(list) && Array.isArray(list.columns) ? list.columns : [];
    return columns
      .filter(
        (column): column is Record<string, unknown> =>
          isRecord(column) &&
          column.kind === "field" &&
          typeof column.key === "string" &&
          [undefined, null, form.key].includes(
            column.formKey as string | null | undefined,
          ),
      )
      .map((column) => String(column.key));
  }

  private async checkSubmissionSources(
    facts: FormOperatorFacts,
    definition: FormDefinition,
    sources: ReturnType<typeof sourcesOf>,
    report: ValidationReport,
    self: { formKey: string; catalog: Record<string, unknown> },
  ): Promise<void> {
    for (const { source, location } of sources) {
      if (source.provider !== FORM_SUBMISSION_PROVIDER || !source.formKey) {
        continue;
      }
      const catalog = isSelfPrefill(source, location, self.formKey)
        ? self.catalog
        : await this.lookups.formSubmissionCatalog(facts, source.formKey);
      const wanted = [source.labelField, source.valueField ?? "id"];
      for (const mapping of mappingOf(definition, location)) {
        wanted.push(mapping.sourceField);
      }
      for (const name of new Set(wanted)) {
        const duplicated = report.errors.some(
          (issue) =>
            issue.message.includes(` ${name}`) &&
            issue.location.fieldKey === location.fieldKey &&
            issue.location.prefillIndex === location.prefillIndex,
        );
        if (name !== "id" && !(name in catalog) && !duplicated) {
          report.errors.push({
            code: "LOOKUP_UNKNOWN_FIELD",
            message: `表單 ${source.formKey} 目前的版本沒有可用的欄位 ${name}(受保護欄位不能當來源)`,
            location,
          });
        }
      }
      checkSubmissionTemplate(source, catalog, location, report);
    }
  }
}
