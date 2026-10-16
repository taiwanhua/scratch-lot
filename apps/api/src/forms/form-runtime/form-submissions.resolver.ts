import {
  Args,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from "@nestjs/graphql";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { FormAccessService } from "../form-access.service";
import { FormVersionPayload } from "../models/form-common.model";
import {
  CopySubmissionToDraftInput,
  CreateAndSubmitFormSubmissionInput,
  CreateFormDraftInput,
  DeleteFormSubmissionInput,
  FormFieldOptionsInput,
  FormLookupInput,
  FormLookupRecordInput,
  FormSubmissionsInput,
  SaveFormDraftInput,
  SubmitFormSubmissionInput,
  UpdateFormSubmissionInput,
  VoidSubmissionInput,
  WithdrawSubmissionInput,
} from "./dto/form-runtime.input";
import { FormFieldOptionsService } from "./form-field-options.service";
import { FormLookupService } from "./form-lookup.service";
import { FormSubmissionsService } from "./form-submissions.service";
import {
  DeleteFormSubmissionPayload,
  FormFieldOptionsPayload,
  FormLookupPayload,
  FormLookupRecordPayload,
  FormSubmissionAttachmentUrlPayload,
  FormSubmissionModel,
  FormSubmissionPayload,
  FormSubmissionRevisionMeta,
  FormSubmissionsPayload,
  FormSummary,
} from "./models/form-submission.model";

/**
 * 表單執行端的端點(所有表單模組共用)。模組是執行期的(`moduleKey` 在 input 或提交上),
 * 所以權限不寫成 `@RequirePermission`:service 依該模組的 `view` / `create` / `edit` / `delete` 判,
 * 錯誤與 `@RequirePermission` 同一種(`FORBIDDEN`,無 reason)。已登入由全域 AuthGuard 守。
 */
@Resolver(() => FormSubmissionModel)
export class FormSubmissionsResolver {
  constructor(
    private readonly service: FormSubmissionsService,
    private readonly lookups: FormLookupService,
    private readonly fieldOptions: FormFieldOptionsService,
    private readonly access: FormAccessService,
  ) {}

  /** 新增選單:某模組此刻可以新增的表單(Spec §3 的交集)。 */
  @Query(() => [FormSummary], { name: "moduleForms" })
  async moduleForms(
    @Args("moduleKey", { type: () => ID }) moduleKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSummary[]> {
    return this.service.moduleForms(
      await this.access.factsOf(operator),
      moduleKey,
    );
  }

  /** 填寫 / 詳情渲染用的版本定義(已發布或已退役版;讀不到的欄位只回骨架)。 */
  @Query(() => FormVersionPayload, { name: "formRuntimeVersion" })
  async formRuntimeVersion(
    @Args("formKey", { type: () => ID }) formKey: string,
    @Args("version", { type: () => Int }) version: number,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormVersionPayload> {
    return this.service.runtimeVersion(
      await this.access.factsOf(operator),
      formKey,
      version,
    );
  }

  @Query(() => FormSubmissionsPayload, { name: "formSubmissions" })
  async formSubmissions(
    @Args("input") input: FormSubmissionsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionsPayload> {
    return this.service.list(await this.access.factsOf(operator), input);
  }

  /** `revision` 省略 = 目前;欄位級權限投影看現在的讀者。 */
  @Query(() => FormSubmissionPayload, { name: "formSubmission" })
  async formSubmission(
    @Args("id", { type: () => ID }) id: string,
    @Args("revision", { type: () => Int, nullable: true })
    revision: number | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.get(
        await this.access.factsOf(operator),
        id,
        revision,
      ),
    };
  }

  /**
   * 修訂紀錄(只有修訂紀錄跳窗問才讀;列表與詳情不載入 `revisions[]`)。重跑單筆的讀取判準,
   * 只取修訂的 metadata、不載入值快照。
   */
  @ResolveField("revisions", () => [FormSubmissionRevisionMeta])
  async revisions(
    @Parent() submission: FormSubmissionModel,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionRevisionMeta[]> {
    return this.service.revisionEntries(
      await this.access.factsOf(operator),
      submission.id,
    );
  }

  /** 上傳欄的私有檔案下載網址(看得到這筆、看得到這一欄才簽)。 */
  @Query(() => FormSubmissionAttachmentUrlPayload, {
    name: "formSubmissionAttachmentUrl",
  })
  async formSubmissionAttachmentUrl(
    @Args("id", { type: () => ID }) id: string,
    @Args("fieldKey", { type: () => String }) fieldKey: string,
    @Args("revision", { type: () => Int, nullable: true })
    revision: number | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionAttachmentUrlPayload> {
    return {
      url: await this.service.attachmentUrl(
        await this.access.factsOf(operator),
        id,
        fieldKey,
        revision,
      ),
    };
  }

  @Mutation(() => FormSubmissionPayload)
  async createFormDraft(
    @Args("input") input: CreateFormDraftInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.createDraft(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  /** 新增頁的 [送出]:一個交易內建立 + 守門 + 送出;失敗不留任何資料。 */
  @Mutation(() => FormSubmissionPayload)
  async createAndSubmitFormSubmission(
    @Args("input") input: CreateAndSubmitFormSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.createAndSubmit(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  @Mutation(() => FormSubmissionPayload)
  async saveFormDraft(
    @Args("input") input: SaveFormDraftInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.saveDraft(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  @Mutation(() => FormSubmissionPayload)
  async submitFormSubmission(
    @Args("input") input: SubmitFormSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.submit(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  @Mutation(() => FormSubmissionPayload)
  async updateFormSubmission(
    @Args("input") input: UpdateFormSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.update(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  @Mutation(() => DeleteFormSubmissionPayload)
  async deleteFormSubmission(
    @Args("input") input: DeleteFormSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteFormSubmissionPayload> {
    return this.service.remove(await this.access.factsOf(operator), input);
  }

  /** 撤回(申請人本人;審核中、還沒有審核意見)。 */
  @Mutation(() => FormSubmissionPayload)
  async withdrawSubmission(
    @Args("input") input: WithdrawSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.withdraw(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  /** 作廢(綁流程且已核准;理由必填、不需審核)。 */
  @Mutation(() => FormSubmissionPayload)
  async voidSubmission(
    @Args("input") input: VoidSubmissionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.voidSubmission(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  /** 複製為新單(已作廢 → 新草稿;`submission.clearedFields` 列出失效被清空的引用欄位)。 */
  @Mutation(() => FormSubmissionPayload)
  async copySubmissionToDraft(
    @Args("input") input: CopySubmissionToDraftInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormSubmissionPayload> {
    return {
      submission: await this.service.copyToDraft(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }

  /** provider / filter 從版本定義取。 */
  @Query(() => FormLookupPayload, { name: "formLookup" })
  async formLookup(
    @Args("input") input: FormLookupInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormLookupPayload> {
    return this.lookups.search(await this.access.factsOf(operator), input);
  }

  /** 選項欄的欄位管理類別選項;類別 key 從版本定義取,不需要欄位管理的權限。 */
  @Query(() => FormFieldOptionsPayload, { name: "formFieldOptions" })
  async formFieldOptions(
    @Args("input") input: FormFieldOptionsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormFieldOptionsPayload> {
    return this.fieldOptions.options(
      await this.access.factsOf(operator),
      input,
    );
  }

  @Query(() => FormLookupRecordPayload, { name: "formLookupRecord" })
  async formLookupRecord(
    @Args("input") input: FormLookupRecordInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FormLookupRecordPayload> {
    return {
      record: await this.lookups.record(
        await this.access.factsOf(operator),
        input,
      ),
    };
  }
}
