import { Injectable } from "@nestjs/common";

import {
  type ArrayColumnDef,
  type ArrayRowValue,
  ComputedCycleError,
  type ExpressionContext,
  type FieldDef,
  type LookupFilterScalar,
  type LookupSourceDescriptor,
  type StoredValues,
  type ValueIssue,
  arrayColumnsOf,
  arrayRowsOf,
  computeAll,
  evaluateCondition,
  filterVarValueOf,
  hasLookupFilterVars,
  lookupFilterVarsOf,
  lookupLabelFieldsOf,
  normalizeFieldValue,
  resolveLookupSource,
  uploadLimitIssue,
  validateValueRules,
  withoutLookupFilterVars,
} from "@repo/domain/form";

import {
  UPLOAD_RULES,
  UploadPurpose,
  isOwnedUploadPath,
} from "../../storage/upload-rules";
import {
  type CategoryOptions,
  FieldCategoryOptionsService,
} from "../field-category-options.service";
import { type FieldGate, fieldGateOf } from "../field-permission-gate";
import type { FormOperatorFacts } from "../form-access.service";
import { forbiddenError, valuesInvalidError } from "../forms-error";
import {
  LookupProvidersService,
  type LookupRecord,
  lookupDisplayLabelOf,
} from "../lookup-providers";
import { REDACTED, isSameStoredValue, semanticOf } from "./stored-values";
import { withStoredTemporals } from "./temporal-values";

/**
 * 寫入的模式:
 * - `draft`:存草稿 —— **放寬的只有完成資料所需的驗證**(必填 / 範圍 / 格式 / custom / 選項是否還在),
 *   寫入守門照常(無 `edit` 送不同值 403、computed / constant 由後端算、隱藏清空),另驗型別與表達式可算
 * - `complete`:送出、已完成修改 —— 全驗,並重取類別 / lookup 選項與引用的 label 寫快照
 */
export type SubmissionWriteMode = "draft" | "complete";

export interface SubmissionWriteInput {
  facts: FormOperatorFacts;
  moduleKey: string;
  formKey: string;
  fields: readonly FieldDef[];
  /** 目前存的值(新草稿為 `{}`)。 */
  base: StoredValues;
  /** 這次送來的值;`null` = 沒有新輸入(送出草稿:以存的值為準重算重驗)。缺席的欄位 = 清空。 */
  sent: StoredValues | null;
  /**
   * 上一個**已完成**修訂的值(已完成修改時 = 目前值;送出草稿時為 null)。
   * 選項 / 引用與它相同時保留原快照、不因來源已停用或已刪而擋下整筆修改。
   */
  previous: StoredValues | null;
  ctx: ExpressionContext;
  mode: SubmissionWriteMode;
  /**
   * **本表單**欄位的權限閘門;不給 = 依操作者的欄位級權限(`fieldGateOf`)。
   * 只有設計器預覽會給(「不套欄位級權限」只指本表單的欄位);lookup / 引用的來源一律用操作者真實的權限。
   */
  gate?: FieldGate;
}

/** 重取選項 label 時共用的東西(類別選項一次請求只查一次)。 */
interface OptionContext {
  facts: FormOperatorFacts;
  categories: Map<string, Promise<CategoryOptions>>;
  issues: ValueIssue[];
  /** 連動篩選引用的表單層欄位此刻的值(這次會存下的最終值)。 */
  filterValueOf: (fieldKey: string) => LookupFilterScalar | null;
}

/** 以一組存值給連動篩選取值(`filterVarValueOf`:引用給 id、單選給 value)。 */
function filterValuesFrom(
  fields: readonly FieldDef[],
  values: StoredValues | null,
): (fieldKey: string) => LookupFilterScalar | null {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return (fieldKey) =>
    values === null
      ? null
      : filterVarValueOf(byKey.get(fieldKey), values[fieldKey]);
}

/** 連動篩選引用的欄位值,這次和上一個已完成修訂不同(同值的引用不能再沿用原快照、要重驗篩選)。 */
function filterVarsChanged(
  source: LookupSourceDescriptor | null | undefined,
  current: (fieldKey: string) => LookupFilterScalar | null,
  previous: (fieldKey: string) => LookupFilterScalar | null,
): boolean {
  return lookupFilterVarsOf(source).some(
    ({ fieldKey }) => current(fieldKey) !== previous(fieldKey),
  );
}

/** 引用重驗的結果:讀得到且符合篩選的(依 id)、讀得到但不符連動篩選的 id。 */
interface ReferenceLookup {
  found: ReadonlyMap<string, LookupRecord>;
  mismatched: ReadonlySet<string>;
}

const NO_REFERENCES: ReferenceLookup = {
  found: new Map(),
  mismatched: new Set(),
};

/** 一欄落在「不能填的四種原因」的哪一種。 */
type FieldClass = "hidden" | "computed" | "kept" | "readonly" | "input";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 提交寫入的後端規則(不能填的四種原因,後端怎麼處理送來的值;見 `docs/modules/forms.md`「提交的寫入規則」),每欄**依序**判定、
 * 命中第一個就照那列處理:
 *
 * 1. `visibleWhen` 算出 false → 清空(null),不算、不驗 —— 同一欄同時隱藏 + 受保護也是清空
 * 2. `computed` / `constant` → 後端算 / 用定義值,送來的忽略;**驗算出的結果**(必填算成 null 擋下)
 * 3. 沒有欄位級 `edit`(或看不到) → 保留既有值;送來的值與既有不同 → 403 整筆拒絕;對此人不驗
 * 4. `readonlyWhen` 算出 true → 保留既有值,送來的忽略;驗既有值
 * 5. 一般可填 → 存送來的值,全驗
 *
 * 條件都以**後端算出的**為準;算條件用的值 = 既有值套上操作者「改得動」的那些欄位送來的值
 * (改不動的欄位送什麼都不影響條件)。
 *
 * **明細列**(`array`)整欄套上面的分類,子欄繼承整欄的結果(不獨立判權限或顯示條件):隱藏 → 整欄 null;
 * 沒有 `edit` → 送來的列集合或 input 子欄和既有不同就 403,保留的列其列內公式子欄仍由後端重算;
 * 整欄需驗時才驗列數與每一格(input 子欄驗送來的值、列內公式子欄驗算出的結果),錯誤定位到 `rowId` + 子欄。
 * 處理順序:型別正規化 → 合併允許保留的既有值 → 依完整依賴圖重算與判條件 → 分類 → 驗 → 存。
 */
@Injectable()
export class SubmissionValuesService {
  constructor(
    private readonly categories: FieldCategoryOptionsService,
    private readonly lookups: LookupProvidersService,
  ) {}

  /** 跑完整條規則;有任何值錯誤 → `VALIDATION_FAILED`(`fieldErrors`),無 edit 送不同值 → 403。 */
  async apply(input: SubmissionWriteInput): Promise<StoredValues> {
    const { values, issues } = await this.evaluate(input);
    if (issues.length > 0) {
      throw valuesInvalidError(issues);
    }
    return values;
  }

  /**
   * 單選 / 多選欄的值重取選項 label 寫快照、驗選項存在(靜態清單比對啟用中的項目,類別 / lookup 查現況;
   * 類別選項一次呼叫只查一次)。其他型別照原樣回。舊版資料升級的補值用:補值要先確定是能選的選項,
   * 升級本身不驗規則。
   */
  async snapshotChoices(
    facts: FormOperatorFacts,
    fields: readonly FieldDef[],
    values: StoredValues,
  ): Promise<{ values: StoredValues; issues: ValueIssue[] }> {
    const context: OptionContext = {
      facts,
      categories: new Map(),
      issues: [],
      filterValueOf: filterValuesFrom(fields, values),
    };
    const resolved: StoredValues = { ...values };
    for (const field of fields) {
      const value = values[field.key];
      if (
        (field.type === "select" || field.type === "multiSelect") &&
        value !== null &&
        value !== undefined
      ) {
        resolved[field.key] = await this.snapshotOf(field, value, context);
      }
    }
    return { values: resolved, issues: context.issues };
  }

  /**
   * 同 `apply`,但值錯誤不丟、連同算好的值一起回(設計器預覽:「若此刻送出會出現的錯誤」)。
   * 型別錯誤與 403 守門照樣丟。
   */
  async evaluate(
    input: SubmissionWriteInput,
  ): Promise<{ values: StoredValues; issues: ValueIssue[] }> {
    const gate =
      input.gate ?? fieldGateOf(input.facts, input.moduleKey, input.formKey);
    const issues: ValueIssue[] = [];
    const normalizedSent = this.normalizeSent(input, gate, issues);
    if (issues.length > 0) {
      throw valuesInvalidError(issues);
    }

    const { classes, final } = this.settle(input, gate, normalizedSent);
    for (const field of input.fields) {
      if (classes.get(field.key) === "kept") {
        this.assertUnchanged(field, gate, input, normalizedSent);
      }
    }
    await this.checkUploads(input, classes, final, issues);
    if (input.mode === "complete") {
      await this.resolveSnapshots(input, classes, final, issues);
      // label 重取後再算一次:`optionLabel` 這類公式要看到的是新快照,不是前端送來的 label
      recompute(input, classes, final);
      this.validateRules(input, classes, final, issues);
    }
    // 值正規化的出口:日期 / 日期時間一律存 Mongo `Date`(domain 一路用 ISO 字串算)
    return { values: withStoredTemporals(input.fields, final), issues };
  }

  /**
   * 分類與最終值**一起收斂**:條件一律用「最終會存下的值」重算(被忽略的送入值、被清空的隱藏欄
   * 都不能影響別欄的條件),分類變了就再算一次,直到不變(上限 = 欄位數 + 1)。
   * 這樣寫入時的判定與讀取時(以存值重算 `fieldStates`)一致,也擋掉「送一個會被忽略的值
   * 去把別欄判成隱藏、清掉它的既有值」這種繞過。
   */
  private settle(
    input: SubmissionWriteInput,
    gate: FieldGate,
    normalizedSent: ReadonlyMap<string, unknown>,
  ): { classes: Map<string, FieldClass>; final: StoredValues } {
    // 第一輪的猜測:既有值 + 改得動的欄位送來的值
    let conditionInput = this.conditionInputOf(input, gate, normalizedSent);
    let classes = new Map<string, FieldClass>();
    let final: StoredValues = {};
    for (let round = 0; round <= input.fields.length; round += 1) {
      const next = new Map<string, FieldClass>();
      for (const field of input.fields) {
        next.set(field.key, this.classify(field, gate, input, conditionInput));
      }
      const stable = round > 0 && sameClasses(classes, next);
      classes = next;
      if (stable) {
        break;
      }
      final = {};
      for (const field of input.fields) {
        final[field.key] = initialValueOf(
          classes.get(field.key) ?? "input",
          field,
          input,
          normalizedSent,
        );
      }
      // 以最終的值重算計算欄位;隱藏的計算欄位維持 null
      recompute(input, classes, final);
      conditionInput = conditionInputFromValues(input, final);
    }
    return { classes, final };
  }

  /**
   * 第一輪算條件用的值:既有值 + 操作者**改得動**的欄位送來的值 + 計算欄位
   * (改不動的欄位送什麼都不影響條件)。之後各輪改用最終值(`settle`)。
   */
  private conditionInputOf(
    input: SubmissionWriteInput,
    gate: FieldGate,
    normalizedSent: ReadonlyMap<string, unknown>,
  ): Parameters<typeof evaluateCondition>[1] {
    const candidate: StoredValues = { ...input.base };
    for (const field of input.fields) {
      if (
        field.valueSource.kind === "input" &&
        gate.canEdit(input.fields, field)
      ) {
        candidate[field.key] = sentOrBase(field, input, normalizedSent);
      }
    }
    Object.assign(
      candidate,
      computeOrThrow(input.fields, candidate, input.ctx),
    );
    return {
      values: semanticOf(input.fields, candidate),
      ctx: input.ctx,
      fields: input.fields,
      stored: candidate,
    };
  }

  /** 型別層:送來的每個值收成存值形狀;形狀不對 → `TYPE_INVALID`(草稿也驗)。 */
  private normalizeSent(
    input: SubmissionWriteInput,
    gate: FieldGate,
    issues: ValueIssue[],
  ): Map<string, unknown> {
    const normalized = new Map<string, unknown>();
    if (input.sent === null) {
      return normalized;
    }
    for (const field of input.fields) {
      if (!(field.key in input.sent) || field.valueSource.kind !== "input") {
        continue;
      }
      const raw = input.sent[field.key];
      if (raw === REDACTED && !gate.canShow(input.fields, field.key)) {
        // 讀者**真的**看不到的欄位,前端原樣送回遮蔽字串:當成「沒動」(由原因 3 守門);
        // 看得到的人送 "[redacted]" 就是一般的值,照型別正規化(不合法就 VALIDATION_FAILED)
        normalized.set(field.key, REDACTED);
        continue;
      }
      // `date` 以租戶時區收斂成當地 00:00;不合法或沒有時區的字串 → TYPE_INVALID
      const result = normalizeFieldValue(field, raw, input.ctx.timezone);
      if (result.ok) {
        normalized.set(field.key, result.value);
      } else {
        issues.push(result.issue);
      }
    }
    return normalized;
  }

  private classify(
    field: FieldDef,
    gate: FieldGate,
    input: SubmissionWriteInput,
    conditionInput: Parameters<typeof evaluateCondition>[1],
  ): FieldClass {
    if (isConditionFalse(field.visibleWhen, conditionInput)) {
      return "hidden";
    }
    if (field.valueSource.kind !== "input") {
      return "computed";
    }
    if (!gate.canEdit(input.fields, field)) {
      return "kept";
    }
    if (isConditionTrue(field.readonlyWhen, conditionInput)) {
      return "readonly";
    }
    return "input";
  }

  /** 原因 3:送來的值與既有不同 → 403;沒送、送遮蔽字串(且真的看不到)、同值都算沒動。 */
  private assertUnchanged(
    field: FieldDef,
    gate: FieldGate,
    input: SubmissionWriteInput,
    normalizedSent: ReadonlyMap<string, unknown>,
  ): void {
    if (input.sent === null || !(field.key in input.sent)) {
      return;
    }
    const sent = normalizedSent.get(field.key);
    const existing = input.base[field.key] ?? null;
    if (sent === REDACTED && !gate.canShow(input.fields, field.key)) {
      return;
    }
    if (!isSameStoredValue(field, sent, existing)) {
      throw forbiddenError(
        `Field ${field.key} is not writable by the operator`,
        "FIELD_FORBIDDEN",
        { fieldKey: field.key },
      );
    }
  }

  /**
   * 上傳欄:只收本 API 簽出來的路徑,檔型 / 大小照 `FORM_ATTACHMENT` 的規則(宣稱的檔型要與路徑副檔名一致),
   * 再套**欄位自己的**檔型 / 大小上限(`rules.accept` / `rules.maxSizeMb`,只能收窄)。欄位上限在**存草稿與送出**
   * 兩處驗,不在上傳完成那一步;大小是前端申報的值(以 GCS metadata 驗實際大小另開票)。
   *
   * - 草稿(上傳完成後存草稿):驗這次換上的新檔(與存的值相同的不重驗)
   * - 送出 / 已完成修改:驗「與上一個已完成修訂不同」的檔 —— 草稿時存下、送出前版本改窄了上限的也擋得到;
   *   已完成修改時沒換的舊檔不因上限改窄而擋下整筆修改
   */
  private checkUploads(
    input: SubmissionWriteInput,
    classes: ReadonlyMap<string, FieldClass>,
    final: StoredValues,
    issues: ValueIssue[],
  ): Promise<void> {
    const rule = UPLOAD_RULES[UploadPurpose.FORM_ATTACHMENT];
    const compareWith =
      input.mode === "complete" ? (input.previous ?? {}) : input.base;
    for (const field of input.fields) {
      const value = final[field.key];
      if (
        field.type !== "upload" ||
        classes.get(field.key) !== "input" ||
        !isRecord(value) ||
        isSameStoredValue(field, value, compareWith[field.key])
      ) {
        continue;
      }
      const path = typeof value.path === "string" ? value.path : "";
      const contentType =
        typeof value.contentType === "string"
          ? value.contentType.toLowerCase()
          : "";
      const size = typeof value.size === "number" ? value.size : -1;
      // 宣稱的檔型要與路徑的副檔名對得上(路徑是本 API 依申報檔型簽出來的,副檔名由它決定):
      // 不能只信前端送的 contentType —— 否則上傳一個 .png、存值時宣稱 application/pdf 就繞過欄位的檔型限制
      const extension = path.slice(path.lastIndexOf(".") + 1);
      if (
        !isOwnedUploadPath(path) ||
        !path.startsWith(`${FORM_UPLOAD_PREFIX}/`) ||
        !(contentType in rule.extensions) ||
        rule.extensions[contentType] !== extension ||
        size < 0 ||
        size > rule.maxBytes ||
        (typeof value.name === "string" &&
          (value.name.trim() === "" || value.name.length > 255))
      ) {
        issues.push({
          fieldKey: field.key,
          code: "UPLOAD_INVALID",
          message: `「${field.label}」的檔案不是有效的上傳結果`,
        });
        continue;
      }
      const limitIssue = uploadLimitIssue(field, value);
      if (limitIssue) {
        issues.push(limitIssue);
      }
    }
    return Promise.resolve();
  }

  /**
   * 送出 / 已完成修改:選項與引用**重取 label 寫快照**(提交時後端重驗 reference 的來源可讀、
   * 重取 label;類別 / lookup 選項同樣)。只處理這次會存下的「一般可填」欄位;
   * 值與上一個已完成修訂相同的保留原快照(來源停用或刪除不擋整筆修改)。
   */
  private async resolveSnapshots(
    input: SubmissionWriteInput,
    classes: ReadonlyMap<string, FieldClass>,
    final: StoredValues,
    issues: ValueIssue[],
  ): Promise<void> {
    const context: OptionContext = {
      facts: input.facts,
      categories: new Map(),
      issues,
      filterValueOf: filterValuesFrom(input.fields, final),
    };
    const previousFilterValueOf = filterValuesFrom(
      input.fields,
      input.previous,
    );
    for (const field of input.fields) {
      const value = final[field.key];
      if (
        classes.get(field.key) !== "input" ||
        value === null ||
        value === undefined
      ) {
        continue;
      }
      const previous = input.previous?.[field.key];
      if (field.type === "array") {
        final[field.key] = await this.snapshotRowsOf(
          field,
          value,
          previous,
          context,
          previousFilterValueOf,
        );
        continue;
      }
      // 同值保留原快照;但連動篩選引用的欄位改了值 → 用最後的值重驗
      final[field.key] =
        previous !== undefined &&
        isSameStoredValue(field, value, previous) &&
        !filterVarsChanged(
          field.source,
          context.filterValueOf,
          previousFilterValueOf,
        )
          ? previous
          : await this.snapshotOf(field, value, context);
    }
  }

  /**
   * 明細列的新快照:每一列的單選子欄(靜態清單驗啟用中、類別重取 label)與引用子欄(重驗來源可讀、重取 label);
   * 與上一個已完成修訂同一列同值的保留原快照。錯誤定位到 `rowId` + 子欄。
   * 引用子欄**同一子欄的 id 合併成一次查詢**(200 列也只查一次),不逐列查。
   */
  private async snapshotRowsOf(
    field: FieldDef,
    value: unknown,
    previous: unknown,
    context: OptionContext,
    previousFilterValueOf: (fieldKey: string) => LookupFilterScalar | null,
  ): Promise<ArrayRowValue[]> {
    const previousRows = new Map(
      arrayRowsOf(previous).map((row) => [row.rowId, row]),
    );
    const inputColumns = arrayColumnsOf(field).filter(
      (column) => column.valueSource.kind === "input",
    );
    const choiceColumns = inputColumns.filter(
      (column) => column.type === "select",
    );
    const rows: ArrayRowValue[] = arrayRowsOf(value).map((row) => ({
      ...row,
    }));
    for (const column of inputColumns) {
      if (column.type === "reference") {
        await this.snapshotReferenceColumn(
          field,
          column,
          rows,
          previousRows,
          context,
          previousFilterValueOf,
        );
      }
    }
    for (const row of rows) {
      for (const column of choiceColumns) {
        const cell = row[column.key];
        if (cell === null || cell === undefined) {
          continue;
        }
        const before = previousRows.get(row.rowId)?.[column.key];
        if (before !== undefined && isSameStoredValue(column, cell, before)) {
          row[column.key] = before;
          continue;
        }
        const issues: ValueIssue[] = [];
        row[column.key] = await this.resolveOption(column, cell, {
          ...context,
          issues,
        });
        context.issues.push(
          ...issues.map((issue) => ({
            ...issue,
            fieldKey: field.key,
            rowId: row.rowId,
            columnKey: column.key,
          })),
        );
      }
    }
    return rows;
  }

  /**
   * 明細的一個引用子欄(就地改 `rows`):與上一個已完成修訂同一列同 id 的保留原快照;其餘的 id 去重後
   * **一次** `findByValues`(`publicOnly`,同表單層引用欄),讀得到的寫 `{ id, label }` 新快照,
   * 讀不到(已刪 / 不在可見範圍)的列 → `SOURCE_UNAVAILABLE`,定位到 `rowId` + 子欄。
   */
  private async snapshotReferenceColumn(
    field: FieldDef,
    column: ArrayColumnDef,
    rows: ArrayRowValue[],
    previousRows: ReadonlyMap<string, ArrayRowValue>,
    context: OptionContext,
    previousFilterValueOf: (fieldKey: string) => LookupFilterScalar | null,
  ): Promise<void> {
    // 連動篩選引用的表單層欄位改了值 → 每一列都用最後的值重驗(不沿用原快照)
    const kept = filterVarsChanged(
      column.source,
      context.filterValueOf,
      previousFilterValueOf,
    )
      ? new Map<string, ArrayRowValue>()
      : previousRows;
    const pending = pendingReferencesOf(column, rows, kept);
    if (pending.length === 0) {
      return;
    }
    const source = column.source;
    const ids = [
      ...new Set(pending.flatMap(({ id }) => (id === null ? [] : [id]))),
    ];
    const { found, mismatched } = source
      ? await this.referencesOf(context, source, ids)
      : NO_REFERENCES;
    for (const { row, id } of pending) {
      const record = id === null ? undefined : found.get(id);
      if (!record || !source) {
        const isMismatch = id !== null && mismatched.has(id);
        context.issues.push({
          fieldKey: field.key,
          rowId: row.rowId,
          columnKey: column.key,
          code: isMismatch ? "LOOKUP_FILTER_MISMATCH" : "SOURCE_UNAVAILABLE",
          message: isMismatch
            ? `「${field.label}」的「${column.label}」不符篩選條件,請重新選擇`
            : `「${field.label}」的「${column.label}」引用的資料不存在或無權讀取`,
        });
        continue;
      }
      row[column.key] = {
        id: record.id,
        label: lookupDisplayLabelOf(record, source),
      };
    }
  }

  /**
   * 引用的 id 一次查回(`publicOnly`)。來源有連動篩選時以這次的最終值換成條件再查;
   * 查不到的 id 再以拿掉連動篩選的來源查一次(只查缺的):讀得到 = 不符篩選(`mismatched`),
   * 讀不到 = 來源不可用。被引用欄位沒有值 → 篩選查無,讀得到的一律算不符。
   */
  private async referencesOf(
    context: OptionContext,
    source: LookupSourceDescriptor,
    ids: readonly string[],
  ): Promise<ReferenceLookup> {
    if (ids.length === 0) {
      return NO_REFERENCES;
    }
    const resolved = resolveLookupSource(source, context.filterValueOf);
    const records =
      resolved === null
        ? []
        : await this.lookups.findByValues(
            context.facts,
            resolved,
            "id",
            ids,
            lookupLabelFieldsOf(source),
            { publicOnly: true },
          );
    const found = new Map(records.map((record) => [record.id, record]));
    const missing = ids.filter((id) => !found.has(id));
    if (!hasLookupFilterVars(source) || missing.length === 0) {
      return { found, mismatched: new Set() };
    }
    const readable = await this.lookups.findByValues(
      context.facts,
      withoutLookupFilterVars(source),
      "id",
      missing,
      [],
      { publicOnly: true },
    );
    return { found, mismatched: new Set(readable.map((record) => record.id)) };
  }

  /** 一欄的新快照:引用重驗來源、選項重取 label(multiSelect 逐項)。 */
  private async snapshotOf(
    field: FieldDef,
    value: unknown,
    context: OptionContext,
  ): Promise<unknown> {
    if (field.type === "reference") {
      return this.resolveReference(field, value, context);
    }
    if (field.type === "select") {
      return this.resolveOption(field, value, context);
    }
    if (field.type === "multiSelect" && Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) {
        items.push(await this.resolveOption(field, item, context));
      }
      return items;
    }
    return value;
  }

  private async resolveReference(
    field: FieldDef,
    value: unknown,
    context: OptionContext,
  ): Promise<unknown> {
    const id =
      isRecord(value) && typeof value.id === "string" ? value.id : null;
    const source = field.source;
    const { found, mismatched } =
      id === null || !source
        ? NO_REFERENCES
        : await this.referencesOf(context, source, [id]);
    const record = id === null ? undefined : found.get(id);
    if (!record || !source) {
      const isMismatch = id !== null && mismatched.has(id);
      context.issues.push({
        fieldKey: field.key,
        code: isMismatch ? "LOOKUP_FILTER_MISMATCH" : "SOURCE_UNAVAILABLE",
        message: isMismatch
          ? `「${field.label}」不符篩選條件,請重新選擇`
          : `「${field.label}」引用的資料不存在或無權讀取`,
      });
      return value;
    }
    return { id: record.id, label: lookupDisplayLabelOf(record, source) };
  }

  /**
   * 選項的一個值:靜態清單比對啟用中的項目;類別 / lookup 查現況並寫 `{ value, label }`;
   * 不在清單內時 `allowCustom` 的存成自訂值,否則 `OPTION_INVALID`。
   */
  private async resolveOption(
    field: FieldDef,
    item: unknown,
    context: OptionContext,
  ): Promise<unknown> {
    const value = isRecord(item) ? item.value : item;
    const isCustom = isRecord(item) && item.custom === true;
    const fallback = (): unknown => {
      if (field.rules?.allowCustom === true && typeof value === "string") {
        return { value, label: value, custom: true };
      }
      context.issues.push({
        fieldKey: field.key,
        code: "OPTION_INVALID",
        message: `「${field.label}」的選項不在可選清單內`,
      });
      return item;
    };
    if (typeof value !== "string" || isCustom) {
      return fallback();
    }
    const label = await this.currentLabelOf(field, value, context);
    if (label === undefined) {
      return fallback();
    }
    return field.options?.kind === "static" ? value : { value, label };
  }

  /** 選項此刻的顯示名;不在可選清單內(不存在 / 已停用 / 讀不到)回 undefined。 */
  private async currentLabelOf(
    field: FieldDef,
    value: string,
    context: OptionContext,
  ): Promise<string | null | undefined> {
    const options = field.options;
    if (options?.kind === "static") {
      return options.items.find(
        (option) => option.value === value && option.enabled,
      )?.label;
    }
    if (options?.kind === "fieldCategory") {
      let pending = context.categories.get(options.key);
      if (!pending) {
        pending = this.categories.options(context.facts.operator, options.key);
        context.categories.set(options.key, pending);
      }
      const categoryOptions = await pending;
      const found = categoryOptions.get(value);
      return found?.enabled ? found.label : undefined;
    }
    if (options?.kind === "lookup") {
      const source: LookupSourceDescriptor = options.source;
      const valueField = source.valueField ?? "id";
      const [record] = await this.lookups.findByValues(
        context.facts,
        source,
        valueField,
        [value],
        [...lookupLabelFieldsOf(source), valueField],
        { publicOnly: true },
      );
      return record ? lookupDisplayLabelOf(record, source) : undefined;
    }
    return undefined;
  }

  /**
   * 完成資料所需的驗證:一般可填、唯讀(驗既有值)、計算欄位(驗算出的結果);隱藏與無 edit 不驗。
   * 明細列回列數與每一格的錯誤(整欄免驗時子欄必填與列數下限一併免驗)。
   */
  private validateRules(
    input: SubmissionWriteInput,
    classes: ReadonlyMap<string, FieldClass>,
    final: StoredValues,
    issues: ValueIssue[],
  ): void {
    const reported = new Set(issues.map((issue) => issue.fieldKey));
    const semantic = semanticOf(input.fields, final);
    for (const field of input.fields) {
      const fieldClass = classes.get(field.key);
      if (
        fieldClass === "hidden" ||
        fieldClass === "kept" ||
        reported.has(field.key)
      ) {
        continue;
      }
      issues.push(
        ...validateValueRules(field, final[field.key], {
          semantic,
          ctx: input.ctx,
          fields: input.fields,
          stored: final,
        }),
      );
    }
  }
}

/**
 * 明細引用子欄要重驗的格(就地把與上一個已完成修訂同一列同 id 的格換回原快照,其餘回傳待查;
 * 存值不是 `{ id }` 的 id 為 null,一律讀不到)。
 */
function pendingReferencesOf(
  column: ArrayColumnDef,
  rows: ArrayRowValue[],
  previousRows: ReadonlyMap<string, ArrayRowValue>,
): { row: ArrayRowValue; id: string | null }[] {
  const pending: { row: ArrayRowValue; id: string | null }[] = [];
  for (const row of rows) {
    const cell = row[column.key];
    if (cell === null || cell === undefined) {
      continue;
    }
    const before = previousRows.get(row.rowId)?.[column.key];
    if (before !== undefined && isSameStoredValue(column, cell, before)) {
      row[column.key] = before;
      continue;
    }
    pending.push({
      row,
      id: isRecord(cell) && typeof cell.id === "string" ? cell.id : null,
    });
  }
  return pending;
}

function sameClasses(
  left: ReadonlyMap<string, FieldClass>,
  right: ReadonlyMap<string, FieldClass>,
): boolean {
  return [...right].every(([key, value]) => left.get(key) === value);
}

/** 以一組存值當條件的輸入(語意值 + ctx + 定義與存值給 `optionLabel`)。 */
function conditionInputFromValues(
  input: SubmissionWriteInput,
  values: StoredValues,
): Parameters<typeof evaluateCondition>[1] {
  return {
    values: semanticOf(input.fields, values),
    ctx: input.ctx,
    fields: input.fields,
    stored: values,
  };
}

/**
 * 以目前的值重算計算 / 固定值欄位(隱藏的維持 null);明細欄(不論送來的或保留的列)的列內公式子欄
 * 也在這裡依完整依賴圖重算。隱藏的欄位以 `computeAll` 的 `hidden` 當 null 算(下游讀到 null,
 * 與前端預覽的 `settleHidden` 同一條)。
 */
function recompute(
  input: SubmissionWriteInput,
  classes: ReadonlyMap<string, FieldClass>,
  final: StoredValues,
): void {
  const hidden = new Set(
    [...classes].flatMap(([key, fieldClass]) =>
      fieldClass === "hidden" ? [key] : [],
    ),
  );
  const computed = computeOrThrow(input.fields, final, input.ctx, hidden);
  for (const field of input.fields) {
    const fieldClass = classes.get(field.key);
    const isComputedArray =
      field.type === "array" &&
      fieldClass !== "hidden" &&
      field.key in computed;
    if (fieldClass === "computed" || isComputedArray) {
      final[field.key] = computed[field.key] ?? null;
    }
  }
}

/** 這次要存的值:沒有新輸入(送出草稿)用存的,否則用送來的(缺席 = 清空)。 */
function sentOrBase(
  field: FieldDef,
  input: SubmissionWriteInput,
  normalizedSent: ReadonlyMap<string, unknown>,
): unknown {
  return input.sent === null
    ? (input.base[field.key] ?? null)
    : (normalizedSent.get(field.key) ?? null);
}

/** 依「不能填的原因」決定這一欄先放什麼(計算欄位稍後以最終值重算)。 */
function initialValueOf(
  fieldClass: FieldClass,
  field: FieldDef,
  input: SubmissionWriteInput,
  normalizedSent: ReadonlyMap<string, unknown>,
): unknown {
  switch (fieldClass) {
    case "hidden":
    case "computed": {
      return null;
    }
    case "kept":
    case "readonly": {
      return input.base[field.key] ?? null;
    }
    case "input": {
      return sentOrBase(field, input, normalizedSent);
    }
  }
}

/** 表單附件的路徑前綴(`storage/upload-rules.ts` 的 `FORM_ATTACHMENT`)。 */
const FORM_UPLOAD_PREFIX = "form";

function isConditionFalse(
  expr: FieldDef["visibleWhen"],
  input: Parameters<typeof evaluateCondition>[1],
): boolean {
  if (expr === undefined || expr === null) {
    return false;
  }
  try {
    return !evaluateCondition(expr, input);
  } catch {
    // 形狀錯誤在發布前就被檢查器擋下;執行期的意外視為「條件不成立」(顯示)
    return false;
  }
}

function isConditionTrue(
  expr: FieldDef["readonlyWhen"],
  input: Parameters<typeof evaluateCondition>[1],
): boolean {
  if (expr === undefined || expr === null) {
    return false;
  }
  try {
    return evaluateCondition(expr, input);
  } catch {
    return false;
  }
}

/** 計算欄位求值;公式成圈(檢查器應已擋下)→ 整筆 `NOT_COMPUTABLE`。 */
function computeOrThrow(
  fields: readonly FieldDef[],
  values: StoredValues,
  ctx: ExpressionContext,
  hidden?: ReadonlySet<string>,
): Record<string, unknown> {
  try {
    return computeAll(fields, {
      values,
      ctx,
      ...(hidden !== undefined && { hidden }),
    });
  } catch (error) {
    if (error instanceof ComputedCycleError) {
      throw valuesInvalidError(
        fields
          .filter(
            (field) =>
              field.valueSource.kind === "computed" ||
              arrayColumnsOf(field).some(
                (column) => column.valueSource.kind === "computed",
              ),
          )
          .map((field) => ({
            fieldKey: field.key,
            code: "NOT_COMPUTABLE" as const,
            message: `「${field.label}」無法計算(公式循環引用)`,
          })),
      );
    }
    throw error;
  }
}
