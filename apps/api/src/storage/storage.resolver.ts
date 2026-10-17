import { Args, Mutation, Resolver } from "@nestjs/graphql";

import { authError } from "../auth/auth-error";
import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { canCreateInFormModule } from "../forms/form-create-access";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import {
  CreateUploadUrlInput,
  UploadUrlPayload,
} from "./models/upload-url.model";
import { StorageService } from "./storage.service";
import { UploadPurpose } from "./upload-rules";

/**
 * 每個用途「誰可以要一張上傳票」(ADR-0010:簽發前先驗操作者權限)。
 * 商標同時出現在編輯組織與開通租戶兩個彈窗,任一權限即可;`@RequirePermission` 是單一 key 的守門,
 * 這裡是「多選一」所以自己查有效權限集合(判斷語意同 PermissionGuard:含同層 wildcard,ADR-0004)。
 */
const SAMPLE_ONE_WRITE = [
  "demo.sub.sample-one.create",
  "demo.sub.sample-one.edit",
] as const;

const PURPOSE_PERMISSIONS: Readonly<Record<UploadPurpose, readonly string[]>> =
  {
    [UploadPurpose.ORG_LOGO]: [
      "system.org-manager.edit",
      "system.org-manager.tenant-ops.provision",
    ],
    // 示範模組1 的封面 / 附件都在「新增 / 編輯」兩個表單裡上傳(#318)
    [UploadPurpose.DEMO_COVER]: SAMPLE_ONE_WRITE,
    [UploadPurpose.DEMO_ATTACHMENT]: SAMPLE_ONE_WRITE,
    // 表單的上傳欄:模組是執行期的,改由 `formModuleWriter` 判(任一表單模組的 create / edit)
    [UploadPurpose.FORM_ATTACHMENT]: [],
  };

/** 簽名上傳網址(ADR-0010);檔案直傳 GCS 不經過 API。 */
@Resolver()
export class StorageResolver {
  constructor(
    private readonly storage: StorageService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Mutation(() => UploadUrlPayload)
  async createUploadUrl(
    @Args("input") input: CreateUploadUrlInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UploadUrlPayload> {
    await this.requirePurposePermission(input.purpose, operator);
    return this.storage.createUploadUrl(input);
  }

  private async requirePurposePermission(
    purpose: UploadPurpose,
    operator: OperatorContext,
  ): Promise<void> {
    const allowed = PURPOSE_PERMISSIONS[purpose];
    if (!operator.actorId) {
      // 防呆:全域 guard 已擋掉未登入,這裡只是讓型別與 PermissionGuard 一致
      throw authError("UNAUTHENTICATED", "Upload requires a login");
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    const isFormWriter =
      purpose === UploadPurpose.FORM_ATTACHMENT &&
      resolution.modules.some(
        (module) =>
          module.engine === "form" &&
          // 新增資格走表單模組的同一份判準(B9b 模組看任一張表單的 `create-<formKey>`)
          (canCreateInFormModule(resolution, module) ||
            holdsPermission(resolution, `${module.key}.edit`)),
      );
    if (
      !isFormWriter &&
      !allowed.some((key) => holdsPermission(resolution, key))
    ) {
      throw authError(
        "FORBIDDEN",
        `Missing permission for upload purpose ${purpose}(${allowed.join(" / ")})`,
      );
    }
  }
}
