import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/audit.service";
import {
  FormVersionsRepository,
  FormsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { TransactionService } from "../../database/transaction";
import {
  type LifecycleOwner,
  type PublishInternalOptions,
  type RetryPublishInternalOptions,
  type VersionLifecycleConfig,
  assertNotPublishing,
  interruptedPublishOf,
  lockDraftForPublish,
  publishExpectationMismatch,
  repositoryVersionStore,
  switchToPublished,
} from "../../versioning/version-lifecycle";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
} from "../form-access.service";
import type { FormVersionRecord } from "../form-mapper";
import {
  conflictError,
  definitionInvalidError,
  validationError,
} from "../forms-error";
import type {
  FormKeyInput,
  PublishFormVersionInput,
} from "./dto/form-design.input";
import { FormDefinitionChecker } from "./form-definition-checker";
import { FormFieldPermissionsService } from "./form-field-permissions.service";
import { FormPublishHooks } from "./form-publish-hooks";

/** 稽核動作名(`docs/modules/forms.md`「稽核」)。 */
export const FORM_VERSION_AUDIT = {
  createDraft: "form-version.create-draft",
  saveDraft: "form-version.save-draft",
  publish: "form-version.publish",
  retryPublish: "form-version.retry-publish",
  retire: "form-version.retire",
  deleteDraft: "form-version.delete-draft",
} as const;

export const FORM_VERSION_TARGET = "form_version";

/** 發布中斷的判定結果:要接續完成的那一版;沒有中斷為 null。 */
export interface PublishState {
  interrupted: FormVersionRecord | null;
}

/**
 * 四步發布(Spec 6a §6「發布」),整個動作是**一個交易**(ADR-0013):
 *
 * 1. 跑檢查器,有錯就停(什麼都沒改)
 * 2. 條件更新 `{ status: "draft", draftRevision: 預期 } → publishing`,同時配正式版號(最大 + 1)、記 changelog;
 *    沒更新到 → 409(兩個發布同時來只有一個搶得到)
 * 3. 欄位級權限:缺的建、有 `retiredAt` 的復活、不再宣告的退役、`name` 隨 label
 * 4. 切換三筆:這一版 `publishing → published` → 前一版 `published → retired` → `forms.currentVersion` 指向新版
 *
 * 任何一步失敗,版本、欄位級權限、`currentVersion` 與稽核一起回到發布前,不會留下「發布中斷」。
 * `retryPublishFormVersion` 與中斷判定保留給交易之前留下的中斷資料(與受管定義安裝的接續),
 * 同樣是一個交易,每個寫入「已是目標狀態就跳過」。
 */
@Injectable()
export class FormPublishService {
  constructor(
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly checker: FormDefinitionChecker,
    private readonly fieldPermissions: FormFieldPermissionsService,
    private readonly hooks: FormPublishHooks,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * 發布中斷 = 有 `publishing` 版本,或有 `published` 版本但它不是 `currentVersion`
   * (步驟 4 的第一筆寫了、最後一筆沒寫)。有中斷時禁止開草稿 / 退役 / 再發布。
   */
  async stateOf(
    operator: OperatorContext,
    form: FormRecord,
  ): Promise<PublishState> {
    return {
      interrupted: await interruptedPublishOf(
        this.lifecycle(operator),
        ownerOf(form),
      ),
    };
  }

  /** 發布進行中(或中斷)→ `CONFLICT`(`PUBLISH_IN_PROGRESS`)。 */
  async assertNotPublishing(
    operator: OperatorContext,
    form: FormRecord,
  ): Promise<void> {
    await assertNotPublishing(this.lifecycle(operator), ownerOf(form));
  }

  /** 表單版本的生命週期設定(`versioning/version-lifecycle.ts`;流程版本共用同一份骨架)。 */
  lifecycle(
    operator: OperatorContext,
  ): VersionLifecycleConfig<FormVersionRecord> {
    return {
      keyField: "formKey",
      versions: repositoryVersionStore(this.versions, operator),
      switchCurrent: async (owner, expected, next) =>
        (await this.forms.findOneAndUpdate(
          operator,
          { key: owner.key, currentVersion: expected },
          { $set: { currentVersion: next } },
        )) !== null,
      conflict: (reason, message) => conflictError(message, reason),
      reached: (checkpoint) => this.hooks.reached(checkpoint),
    };
  }

  /**
   * `internal`:只給內部的受管定義安裝用(`PublishInternalOptions`)—— 指名草稿、並要求表單與
   * `currentVersion` 還是登記時的樣子;不符在配版號與任何寫入之前就拒絕。後面三筆切換以**同一次讀到的**
   * `currentVersion` 做條件更新,所以通過這裡之後現場再變也切不過去。
   */
  async publish(
    facts: FormOperatorFacts,
    input: PublishFormVersionInput,
    internal: PublishInternalOptions = {},
  ): Promise<FormVersionRecord> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    const changelog = input.changelog.trim();
    if (changelog === "") {
      throw validationError("changelog is required", ["changelog"]);
    }
    const mismatch = publishExpectationMismatch(form, internal.expected);
    if (mismatch !== null) {
      throw conflictError(mismatch, "CURRENT_VERSION_CHANGED");
    }
    await this.assertNotPublishing(operator, form);
    const draft = await this.versions.findOne(operator, {
      ...(internal.draftId === undefined ? {} : { _id: internal.draftId }),
      formKey: form.key,
      status: "draft",
    });
    if (!draft) {
      throw conflictError(`Form ${form.key} has no draft`, "DRAFT_MISSING");
    }
    if (draft.draftRevision !== input.expectedDraftRevision) {
      throw conflictError(
        `Draft revision mismatch: expected ${String(input.expectedDraftRevision)}, actual ${String(draft.draftRevision)}`,
        "DRAFT_REVISION_MISMATCH",
      );
    }

    // 步驟 1:檢查器
    const report = await this.checker.check(facts, form, {
      fields: draft.fields,
      layout: draft.layout,
      summaryMap: draft.summaryMap,
      prefills: draft.prefills,
    });
    if (report.errors.length > 0) {
      throw definitionInvalidError(
        `Form ${form.key} draft has ${String(report.errors.length)} definition error(s)`,
        report.errors,
      );
    }

    // 步驟 2–4 + 稽核:一個交易。檢查器只讀(且內部平行讀),放在交易前;檢查之後草稿若被改過,
    // 步驟 2 以 draftRevision 為條件的搶鎖就不會命中
    return this.transactions.withTransaction(async () => {
      // 步驟 2:搶鎖並配版號(草稿還是讀到的那一份才改;兩個發布同時來只有一個命中)
      const locked = await lockDraftForPublish(
        this.lifecycle(operator),
        ownerOf(form),
        draft._id,
        input.expectedDraftRevision,
        changelog,
      );
      await this.audit.record(operator, {
        action: FORM_VERSION_AUDIT.publish,
        targetType: FORM_VERSION_TARGET,
        targetId: locked._id,
        after: { formKey: form.key, version: locked.version, changelog },
      });
      return this.finish(operator, form, locked);
    });
  }

  /**
   * 從步驟 3 冪等重跑;沒有中斷的發布 → `CONFLICT`(`PUBLISH_NOT_INTERRUPTED`)。
   * `internal.versionId`:只給內部的受管定義安裝用 —— 只接續那一版;此刻中斷的是別的版本同樣回
   * `PUBLISH_NOT_INTERRUPTED`(在稽核、欄位級權限與切換之前判斷,接著處理的就是這裡選中的那一版)。
   */
  retry(
    facts: FormOperatorFacts,
    input: FormKeyInput,
    internal: RetryPublishInternalOptions = {},
  ): Promise<FormVersionRecord> {
    return this.transactions.withTransaction(() =>
      this.retryInTransaction(facts, input, internal),
    );
  }

  private async retryInTransaction(
    facts: FormOperatorFacts,
    input: FormKeyInput,
    internal: RetryPublishInternalOptions,
  ): Promise<FormVersionRecord> {
    const operator = facts.operator;
    const form = await this.access.requireWritableForm(facts, input.formKey);
    const { interrupted } = await this.stateOf(operator, form);
    if (!interrupted) {
      throw conflictError(
        `Form ${form.key} has no interrupted publish`,
        "PUBLISH_NOT_INTERRUPTED",
      );
    }
    if (
      internal.versionId !== undefined &&
      !interrupted._id.equals(internal.versionId)
    ) {
      throw conflictError(
        `Form ${form.key} interrupted publish is version ${String(interrupted.version)}, not the expected one`,
        "PUBLISH_NOT_INTERRUPTED",
      );
    }
    await this.audit.record(operator, {
      action: FORM_VERSION_AUDIT.retryPublish,
      targetType: FORM_VERSION_TARGET,
      targetId: interrupted._id,
      after: { formKey: form.key, version: interrupted.version },
    });
    return this.finish(operator, form, interrupted);
  }

  /** 步驟 3、4;每一筆寫入都「已是目標狀態就跳過」。 */
  private async finish(
    operator: OperatorContext,
    form: FormRecord,
    target: FormVersionRecord,
  ): Promise<FormVersionRecord> {
    // 步驟 3:欄位級權限(`name` 用表單現在的名稱)
    await this.fieldPermissions.syncForVersion(operator, form, target.fields);
    // 步驟 4:三筆切換
    return switchToPublished(
      this.lifecycle(operator),
      ownerOf(form),
      target,
      operator.actorId,
    );
  }
}

function ownerOf(form: FormRecord): LifecycleOwner {
  return { key: form.key, currentVersion: form.currentVersion };
}
