import { Injectable } from "@nestjs/common";

import type { WorkflowDefinitionSeedSet } from "@repo/domain/seed";

import { WorkflowVersionsRepository } from "../../database/database.module";
import type { FormOperatorFacts } from "../../forms/form-access.service";
import {
  assertSeedExportInput,
  definitionSeedFileOf,
  toPlainJson,
} from "../../forms/form-design/seed-export";
import { SeedExportCatalogService } from "../../forms/form-design/seed-export-catalog.service";
import { WorkflowAccessService } from "../workflow-access.service";
import { definitionOfVersion } from "../workflow-definition-input";
import { WORKFLOWS_PERMISSIONS } from "../workflow-keys";
import {
  workflowForbiddenError,
  workflowNotFoundError,
  workflowValidationError,
} from "../workflows-error";
import type { ExportWorkflowSeedInput } from "./dto/workflow-design.input";
import type { ExportWorkflowSeedPayload } from "./models/workflow.model";

/** 匯出沿用設計服務的判準:讀(`view`)加發布(`publish`)。 */
const EXPORT_PERMISSIONS = [
  WORKFLOWS_PERMISSIONS.view,
  WORKFLOWS_PERMISSIONS.publish,
] as const;

/**
 * 把共用流程的**指定已發布版本**匯出成專案設定檔(`docs/modules/workflows.md`「匯出專案設定」)。
 *
 * - 守門在這裡做完,不靠畫面藏按鈕:`view` + `publish`、站在根組織、共用流程(`ownerOrgId = null` 且 `tenantId = null`)
 * - 版本由呼叫端指名;不是已發布、或發布還沒切換完,一律拒絕,不拿目前版本代替
 * - 輸出不含資料庫 id、版號、時間、發布者、分派與綁定;`desiredStatus` 固定 `published`
 * - 可攜性檢查與輸出格式和表單共用同一份(`forms/form-design/seed-export.ts`)
 * - 唯讀:不寫資料庫、不留稽核
 */
@Injectable()
export class WorkflowSeedExportService {
  constructor(
    private readonly access: WorkflowAccessService,
    private readonly versions: WorkflowVersionsRepository,
    private readonly catalog: SeedExportCatalogService,
  ) {}

  async export(
    facts: FormOperatorFacts,
    input: ExportWorkflowSeedInput,
  ): Promise<ExportWorkflowSeedPayload> {
    for (const key of EXPORT_PERMISSIONS) {
      this.access.assertPermission(facts, key);
    }
    if (!facts.isRoot) {
      throw workflowForbiddenError(
        "Only the root organization can export project seeds",
        "ROOT_ONLY",
      );
    }
    assertSeedExportInput(input, workflowValidationError);
    // 站在根組織讀得到的只有共用流程;租戶的客製流程一律當不存在
    const workflow = await this.access.requireReadable(
      facts,
      input.workflowKey,
    );
    // 共用 = 擁有組織與租戶邊界都是 null;兩者相等只由建立時的寫入保證,這個邊界兩個都明驗
    if (workflow.tenantId !== null || workflow.ownerOrgId !== null) {
      throw workflowNotFoundError(`Workflow not found: ${input.workflowKey}`);
    }
    const version = await this.versions.findOne(facts.operator, {
      workflowKey: workflow.key,
      version: input.version,
    });
    if (!version) {
      throw workflowNotFoundError(
        `Workflow version not found: ${workflow.key}@${String(input.version)}`,
      );
    }
    if (version.status !== "published") {
      throw workflowValidationError(
        `Version ${String(input.version)} of ${workflow.key} is not published`,
        ["version"],
      );
    }
    const seed: WorkflowDefinitionSeedSet = {
      kind: "workflow-definition",
      key: workflow.key,
      revision: input.revision,
      name: workflow.name,
      changelog: input.changelog,
      desiredStatus: "published",
      checkFormKey: version.checkFormKey ?? null,
      definition: toPlainJson(definitionOfVersion(version)),
    };
    return definitionSeedFileOf(
      seed,
      await this.catalog.catalogOf(facts.operator),
    );
  }
}
