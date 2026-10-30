import { fieldProtections } from "./dependencies";
import { IssueCollector, type ValidationReport } from "./issues";
import {
  DEFAULT_WIDGET_REGISTRY,
  type LookupProviderRegistry,
  type WidgetRegistry,
} from "./registry";
import type { FieldDef, FormDefinition } from "./types";
import { validateArrayFields } from "./validate-array";
import { validateDefaults } from "./validate-defaults";
import { validateExpressionTypes } from "./validate-expression-types";
import { validateExpressions } from "./validate-expressions";
import { type RegexSafetyCheck, validateFields } from "./validate-fields";
import { validateLookupFilters } from "./validate-lookup-filters";
import {
  collectFieldWarnings,
  validateLayout,
  validatePrefills,
  validateSummary,
} from "./validate-structure";

export interface ValidateDefinitionOptions {
  /** 已發布版本的欄位:同 key 改了型別 → `KEY_TYPE_CHANGED`。 */
  previousFields?: readonly FieldDef[];
  /** 欄位管理類別 key;不給就不檢查 `OPTIONS_UNKNOWN_CATEGORY`。 */
  fieldCategoryKeys?: ReadonlySet<string>;
  /** lookup 來源登錄表;不給就不檢查 provider / 來源欄位。 */
  lookupProviders?: LookupProviderRegistry;
  /** widget 登錄表;預設 `DEFAULT_WIDGET_REGISTRY`。 */
  widgets?: WidgetRegistry;
  /** 列表欄位配置(`modules.settings.list`)引用的表單欄位 key;不給就不出 `LIST_COLUMN_MISSING`。 */
  listColumnFieldKeys?: readonly string[];
  /**
   * ReDoS 檢查,**必填**:api 傳 `@repo/domain/form-regex-safety` 的 `recheckRegexSafety`;
   * admin 設計器懶載入同一支(不讓 recheck 進首屏 bundle)。
   */
  regexSafety: RegexSafetyCheck;
}

/**
 * 定義檢查器:設計器即時 + 發布時 api 再跑。**有錯不能發布,警告可發布**;
 * 表達式另跑型別檢查(與設計器選擇器同一張型別表)與預設值規則;
 * 每筆都帶定位(欄位 key / 表達式槽與路徑 / 版面位置 / 摘要槽 / 帶入規則)。
 * 草稿裡刪了被引用的欄位不自動修:引用處在這裡變成錯誤,由設計者手動改。
 */
export function validateDefinition(
  definition: FormDefinition,
  options: ValidateDefinitionOptions,
): ValidationReport {
  const collector = new IssueCollector();
  const protections = fieldProtections(definition.fields);
  validateFields(
    definition.fields,
    {
      widgets: options.widgets ?? DEFAULT_WIDGET_REGISTRY,
      regexSafety: options.regexSafety,
      ...(options.previousFields && { previousFields: options.previousFields }),
      ...(options.fieldCategoryKeys && {
        fieldCategoryKeys: options.fieldCategoryKeys,
      }),
      ...(options.lookupProviders && {
        lookupProviders: options.lookupProviders,
      }),
    },
    collector,
  );
  validateArrayFields(
    definition.fields,
    {
      widgets: options.widgets ?? DEFAULT_WIDGET_REGISTRY,
      regexSafety: options.regexSafety,
      ...(options.fieldCategoryKeys && {
        fieldCategoryKeys: options.fieldCategoryKeys,
      }),
      // 引用子欄的來源照表單層引用欄對照登錄表
      ...(options.lookupProviders && {
        lookupProviders: options.lookupProviders,
      }),
    },
    collector,
  );
  validateDefaults(definition.fields, collector, options.lookupProviders);
  validateExpressions(definition.fields, protections, collector);
  validateExpressionTypes(definition.fields, collector);
  validateLayout(definition, collector);
  validateSummary(definition, protections, collector);
  validatePrefills(definition, options.lookupProviders, collector);
  validateLookupFilters(definition, options.lookupProviders, collector);
  collectFieldWarnings(definition, options.listColumnFieldKeys, collector);
  return { errors: collector.errors, warnings: collector.warnings };
}
