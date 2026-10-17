import { Injectable } from "@nestjs/common";

import { validateAudience } from "@repo/domain/audience";
import type { FieldDef } from "@repo/domain/form";
import {
  APPROVER_AUDIENCE_OPTIONS,
  type ValidateWorkflowOptions,
  type WorkflowDefinition,
  type WorkflowValidationReport,
  audienceStaticIdsOf,
  isReviewStep,
  validateWorkflowDefinition,
} from "@repo/domain/workflow";

import {
  FormVersionsRepository,
  FormsRepository,
} from "../../database/database.module";
import type { WorkflowRecord } from "../../database/workflows.repository";
import type { FormOperatorFacts } from "../../forms/form-access.service";
import { TenantDirectoryService } from "../tenant-directory.service";

/**
 * 檢查用表單的選項:對得到目前版本 → 以它的欄位驗跳過條件;表單不存在、看不到或沒有目前版本 →
 * `CHECK_FORM_UNAVAILABLE`(擋發布),跳過條件只驗形狀。
 */
function checkFormOptionsOf(
  checkFormKey: string | null,
  forms: ReadonlyMap<string, readonly FieldDef[] | null>,
): Pick<
  ValidateWorkflowOptions,
  "checkFormFields" | "unavailableCheckFormKey"
> {
  if (checkFormKey === null) {
    return {};
  }
  const fields = forms.get(checkFormKey);
  return fields === undefined || fields === null
    ? { unavailableCheckFormKey: checkFormKey }
    : { checkFormFields: fields };
}

/** 人員條件裡指定的使用者(格式不對的條件交給檢查器報 `AUDIENCE_INVALID`,這裡當沒有)。 */
function userIdsOf(audience: unknown): string[] {
  const validation = validateAudience(audience, APPROVER_AUDIENCE_OPTIONS);
  return validation.ok ? audienceStaticIdsOf(validation.audience, "user") : [];
}

/**
 * 流程定義檢查器的 api 端(Spec 6b §5「定義檢查器」):規則正本是 `@repo/domain/workflow` 的
 * `validateWorkflowDefinition`,這裡只把它要的目錄從資料庫組好 ——
 * 共用 / 客製、本租戶的角色 / 組織與使用者、`field` 來源表單與「檢查用表單」的**目前版本**欄位。
 *
 * 表單目錄的範圍跟著流程走:共用流程只認共用表單;客製流程認共用表單與自己租戶的客製表單
 * (別租戶的客製表單一律當不存在,同 `FormAccessService.isRuntimeVisible`)。
 */
@Injectable()
export class WorkflowDefinitionChecker {
  constructor(
    private readonly forms: FormsRepository,
    private readonly formVersions: FormVersionsRepository,
    private readonly directory: TenantDirectoryService,
  ) {}

  async check(
    facts: FormOperatorFacts,
    // 只用到租戶邊界:還沒建立的流程(受管定義安裝的寫入前檢查)也能先驗
    workflow: Pick<WorkflowRecord, "tenantId">,
    definition: WorkflowDefinition,
    checkFormKey?: string | null,
  ): Promise<WorkflowValidationReport> {
    return validateWorkflowDefinition(
      definition,
      await this.optionsOf(facts, workflow, definition, checkFormKey ?? null),
    );
  }

  private async optionsOf(
    facts: FormOperatorFacts,
    // 只用到租戶邊界:還沒建立的流程(受管定義安裝的寫入前檢查)也能先驗
    workflow: Pick<WorkflowRecord, "tenantId">,
    definition: WorkflowDefinition,
    checkFormKey: string | null,
  ): Promise<ValidateWorkflowOptions> {
    const tenantId = workflow.tenantId;
    const reviewSteps = definition.steps.filter((step) => isReviewStep(step));
    const formKeys = new Set<string>();
    const userIds: string[] = [];
    // 審核者、關卡與整個流程的知會對象、逾時通知對象:檢查器都要對到它們的表單與使用者
    const sources = [
      ...reviewSteps.flatMap((step) => [step.assignee, step.cc]),
      definition.cc,
    ];
    for (const source of sources) {
      if (source?.kind === "field") {
        formKeys.add(source.formKey);
      } else if (source?.kind === "audience") {
        userIds.push(...userIdsOf(source.audience));
      }
    }
    for (const step of reviewSteps) {
      userIds.push(...userIdsOf(step.overdue?.audience));
    }
    if (checkFormKey !== null) {
      formKeys.add(checkFormKey);
    }
    const forms = new Map<string, readonly FieldDef[] | null>();
    for (const formKey of formKeys) {
      const fields = await this.currentFieldsOf(facts, workflow, formKey);
      if (fields !== undefined) {
        forms.set(formKey, fields);
      }
    }
    return {
      isShared: tenantId === null,
      ...(tenantId === null
        ? {}
        : {
            tenantRoleIds: await this.directory.tenantRoleIds(tenantId),
            tenantOrgIds: await this.directory.tenantOrgIdSet(tenantId),
            users: await this.directory.userFacts(tenantId, userIds),
          }),
      forms,
      ...checkFormOptionsOf(checkFormKey, forms),
    };
  }

  /** 表單目前版本的欄位;表單不存在(或不在這個流程看得到的範圍)→ undefined;沒有目前版本 → null。 */
  private async currentFieldsOf(
    facts: FormOperatorFacts,
    // 只用到租戶邊界:還沒建立的流程(受管定義安裝的寫入前檢查)也能先驗
    workflow: Pick<WorkflowRecord, "tenantId">,
    formKey: string,
  ): Promise<readonly FieldDef[] | null | undefined> {
    const form = await this.forms.findOne(facts.operator, { key: formKey });
    if (form === null) {
      return undefined;
    }
    const isVisible =
      form.ownerOrgId === null ||
      (workflow.tenantId !== null && form.ownerOrgId.equals(workflow.tenantId));
    if (!isVisible) {
      return undefined;
    }
    if (form.currentVersion === null) {
      return null;
    }
    const version = await this.formVersions.findOne(facts.operator, {
      formKey,
      version: form.currentVersion,
    });
    return version?.fields ?? null;
  }
}
