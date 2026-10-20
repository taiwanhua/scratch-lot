import { Injectable } from "@nestjs/common";

import { arrayColumnsOf } from "@repo/domain/form";

import { FormVersionsRepository } from "../../database/database.module";
import { voidReasonCategoryOf } from "../../database/schemas/form.schema";
import { FieldCategoryOptionsService } from "../field-category-options.service";
import { fieldGateOf, requiredShowKeys } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../form-access.service";
import type { FormVersionRecord } from "../form-mapper";
import { FORMS_PERMISSIONS } from "../form-permission-keys";
import { forbiddenError, notFoundError, validationError } from "../forms-error";
import {
  type FormFieldOptionsInput,
  MAX_PAGE_SIZE,
} from "./dto/form-runtime.input";
import type {
  FormFieldOption,
  FormFieldOptionsPayload,
  FormVoidReasonOptionsPayload,
} from "./models/form-submission.model";

/**
 * `formFieldOptions`(`options` 三種來源的「欄位管理類別」):填寫者取類別選項的執行端查詢,
 * **不需要** `system.field-manager.view`。
 *
 * - 類別 key 從版本定義取(與 `formLookup` 同一原則),前端只帶「哪一版的哪一個欄位」
 * - 可選範圍 = `FieldCategoryOptionsService` 的合併範圍(送出時驗值也用它,兩邊不會分岔);只列啟用中的
 * - 已發布 / 退役版:表單要在執行端看得到(共用或本租戶客製,否則 `NOT_FOUND`)+ 模組
 *   `view` / `create` / `edit` 任一(同 `formRuntimeVersion`);讀者沒有這一欄的 `show` → `FORBIDDEN`
 *   (定義投影也不給它選項,見 `definition-projection.ts`)
 * - 草稿(`version` 省略):設計器預覽,要表單管理的檢視且讀得到這張表單;不套欄位級權限(同 `formLookup`)
 */
@Injectable()
export class FormFieldOptionsService {
  constructor(
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly categories: FieldCategoryOptionsService,
  ) {}

  async options(
    facts: FormOperatorFacts,
    input: FormFieldOptionsInput,
  ): Promise<FormFieldOptionsPayload> {
    const { version, moduleKey, isDraft } = await this.resolveVersion(
      facts,
      input,
    );
    // 明細子欄以 `<明細 key>.<子欄 key>` 指定;權限看整個明細欄(子欄沒有自己的權限)
    // 只收 `<欄位 key>` 或 `<明細 key>.<子欄 key>` 兩種;多於兩段一律當不存在的欄位
    const segments = input.fieldKey.split(".");
    const [fieldKey, columnKey] =
      segments.length <= 2 ? segments : [undefined, undefined];
    const field = version.fields.find(
      (candidate) => candidate.key === fieldKey,
    );
    // 先看讀不讀得到,再看欄位種類:否則讀不到的人能從錯誤碼的差別推出這欄的 `options.kind`
    // (骨架刻意省略的就是 `options`)
    if (
      field !== undefined &&
      !isDraft &&
      !fieldGateOf(facts, moduleKey, version.formKey).canShow(
        version.fields,
        field.key,
      )
    ) {
      throw forbiddenError(
        `Missing field permission: ${requiredShowKeys(version.fields, field.key).join(", ")}`,
      );
    }
    const target =
      columnKey === undefined || field === undefined
        ? field
        : arrayColumnsOf(field).find((column) => column.key === columnKey);
    if (target?.options?.kind !== "fieldCategory") {
      throw validationError(
        `Field ${input.fieldKey} has no field category options`,
        ["fieldKey"],
      );
    }
    const found = await this.categories.options(
      facts.operator,
      target.options.key,
    );
    const keyword = input.keyword?.trim().toLowerCase() ?? "";
    const matched: FormFieldOption[] = [...found]
      .filter(([, option]) => option.enabled)
      .map(([value, option]) => ({ value, label: option.label }))
      .filter(
        (option) =>
          keyword === "" ||
          option.label.toLowerCase().includes(keyword) ||
          option.value.toLowerCase().includes(keyword),
      );
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? MAX_PAGE_SIZE),
    );
    return {
      items: matched.slice((page - 1) * pageSize, page * pageSize),
      totalCount: matched.length,
      page,
      pageSize,
    };
  }

  /**
   * `formVoidReasonOptions`:作廢對話框的原因選項 = 表單設定 `voidReasonCategoryKey` 那個類別啟用中的選項
   * (同 `options` 的合併範圍,作廢時驗值也用它)。守門同執行端(表單看得到 + 模組 `view` / `create` / `edit` 任一),
   * 不需要欄位管理的權限;沒設類別 → `categoryKey: null`、沒有選項(作廢原因自由填寫)。
   */
  async voidReasonOptions(
    facts: FormOperatorFacts,
    formKey: string,
  ): Promise<FormVoidReasonOptionsPayload> {
    const form = await this.access.findRuntimeForm(facts, formKey);
    if (!form) {
      throw notFoundError(`Form not found: ${formKey}`);
    }
    this.access.assertRuntimeAccess(facts, form.moduleKey, form.key);
    const categoryKey = voidReasonCategoryOf(form);
    if (categoryKey === null) {
      return { categoryKey: null, items: [] };
    }
    const found = await this.categories.options(facts.operator, categoryKey);
    return {
      categoryKey,
      items: [...found]
        .filter(([, option]) => option.enabled)
        .map(([value, option]) => ({ value, label: option.label })),
    };
  }

  private async resolveVersion(
    facts: FormOperatorFacts,
    input: FormFieldOptionsInput,
  ): Promise<{
    version: FormVersionRecord;
    moduleKey: string;
    isDraft: boolean;
  }> {
    const isDraft = input.version === null || input.version === undefined;
    if (isDraft) {
      if (!this.access.has(facts, FORMS_PERMISSIONS.view)) {
        throw forbiddenError(`Missing permission ${FORMS_PERMISSIONS.view}`);
      }
      const form = await this.access.requireReadableForm(facts, input.formKey);
      const draft = await this.versions.findOne(facts.operator, {
        formKey: form.key,
        status: "draft",
      });
      if (!draft) {
        throw notFoundError(`Form version not found: ${form.key}@draft`);
      }
      return { version: draft, moduleKey: form.moduleKey, isDraft };
    }
    const form = await this.access.findRuntimeForm(facts, input.formKey);
    if (!form) {
      throw notFoundError(`Form not found: ${input.formKey}`);
    }
    this.access.assertRuntimeAccess(facts, form.moduleKey, form.key);
    const version = await this.versions.findOne(facts.operator, {
      formKey: form.key,
      version: input.version,
      status: { $in: ["published", "retired"] },
    });
    if (!version) {
      throw notFoundError(
        `Form version not found: ${form.key}@${String(input.version)}`,
      );
    }
    return { version, moduleKey: form.moduleKey, isDraft };
  }
}
