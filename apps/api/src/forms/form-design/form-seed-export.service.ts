import { Injectable } from "@nestjs/common";

import { type FormDefinition, normalizeSerialFormat } from "@repo/domain/form";
import type { FormDefinitionSeedSet } from "@repo/domain/seed";

import { FormVersionsRepository } from "../../database/database.module";
import {
  allowsDraft,
  voidReasonCategoryOf,
} from "../../database/schemas/form.schema";
import {
  FormAccessService,
  type FormOperatorFacts,
} from "../form-access.service";
import { FORMS_PERMISSIONS } from "../form-permission-keys";
import { forbiddenError, notFoundError, validationError } from "../forms-error";
import type { ExportFormSeedInput } from "./dto/form-design.input";
import type { ExportFormSeedPayload } from "./models/form.model";
import {
  assertSeedExportInput,
  definitionSeedFileOf,
  toPlainJson,
} from "./seed-export";
import { SeedExportCatalogService } from "./seed-export-catalog.service";

/** 匯出沿用設計服務的判準:讀(`view`)加改(`edit`,表單的發布權限)。 */
const EXPORT_PERMISSIONS = [
  FORMS_PERMISSIONS.view,
  FORMS_PERMISSIONS.edit,
] as const;

/**
 * 把共用表單的**指定已發布版本**匯出成專案設定檔(`docs/modules/forms.md`「匯出專案設定」)。
 *
 * - 守門在這裡做完,不靠畫面藏按鈕:`view` + `edit`、站在根組織、共用表單(`ownerOrgId = null`)
 * - 讀的是設計端的完整版本(`form_versions` 那一筆),不是執行端依欄位級權限遮過的投影
 * - 版本由呼叫端指名;不是已發布、或發布還沒切換完,一律拒絕,不拿目前版本代替
 * - 輸出不含資料庫 id、版號、時間、發布者、分派與綁定;`desiredStatus` 固定 `published`
 * - 唯讀:不寫資料庫、不留稽核
 */
@Injectable()
export class FormSeedExportService {
  constructor(
    private readonly access: FormAccessService,
    private readonly versions: FormVersionsRepository,
    private readonly catalog: SeedExportCatalogService,
  ) {}

  async export(
    facts: FormOperatorFacts,
    input: ExportFormSeedInput,
  ): Promise<ExportFormSeedPayload> {
    for (const key of EXPORT_PERMISSIONS) {
      if (!this.access.has(facts, key)) {
        throw forbiddenError(`Missing permission ${key}`);
      }
    }
    if (!facts.isRoot) {
      throw forbiddenError(
        "Only the root organization can export project seeds",
        "ROOT_ONLY",
      );
    }
    assertSeedExportInput(input, validationError);
    // 站在根組織讀得到的只有共用表單;租戶的客製表單一律當不存在
    const form = await this.access.requireReadableForm(facts, input.formKey);
    if (form.ownerOrgId !== null) {
      throw notFoundError(`Form not found: ${input.formKey}`);
    }
    const version = await this.versions.findOne(facts.operator, {
      formKey: form.key,
      version: input.version,
    });
    if (!version) {
      throw notFoundError(
        `Form version not found: ${form.key}@${String(input.version)}`,
      );
    }
    if (version.status !== "published") {
      throw validationError(
        `Version ${String(input.version)} of ${form.key} is not published`,
        ["version"],
      );
    }
    const serial = normalizeSerialFormat(form.serial ?? null);
    const voidReasonCategory = voidReasonCategoryOf(form);
    const seed: FormDefinitionSeedSet = {
      kind: "form-definition",
      key: form.key,
      revision: input.revision,
      name: form.name,
      changelog: input.changelog,
      desiredStatus: "published",
      moduleKey: form.moduleKey,
      tabLabelTemplate: form.tabLabelTemplate,
      // 允許存草稿:只有關掉才寫(缺席 = 開)
      ...(allowsDraft(form) ? {} : { allowDraft: false }),
      // 單號格式:有設才寫(缺席 = 不給號)
      ...(serial === null ? {} : { serial }),
      // 作廢原因類別:有設才寫(缺席 = 自由填寫)
      ...(voidReasonCategory === null
        ? {}
        : { voidReasonCategoryKey: voidReasonCategory }),
      definition: toPlainJson<FormDefinition>({
        fields: version.fields,
        layout: version.layout,
        summaryMap: version.summaryMap,
        prefills: version.prefills,
      }),
    };
    return definitionSeedFileOf(
      seed,
      await this.catalog.catalogOf(facts.operator),
    );
  }
}
