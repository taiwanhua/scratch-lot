import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { CORE_RELATIONSHIPS_COLLECTION } from "../../database/schemas/core-relationship.schema";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { findPermissionIdByKey } from "../../permission/test-support/fixtures";
import {
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  CREATE_DRAFT as CREATE_VERSION_DRAFT,
  DELETE_SUBMISSION,
  F,
  FORK_FORM,
  FORMS_MODULES,
  FORM_LOOKUP,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  SAVE_FORM_DRAFT,
  SUBMIT,
  UPDATE_FORM,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  field,
  nextRequestId,
  ok,
  publishNewForm,
  rootToken,
  saveDefinition,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const MODULE_FORMS = /* GraphQL */ `
  query ModuleForms($moduleKey: ID!) {
    moduleForms(moduleKey: $moduleKey) {
      key
      canCreate
    }
  }
`;

const CREATE_AND_SUBMIT = /* GraphQL */ `
  mutation CreateAndSubmit($input: CreateAndSubmitFormSubmissionInput!) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        id
        status
      }
    }
  }
`;

const ABILITIES = /* GraphQL */ `
  query Abilities($id: ID!) {
    formSubmission(id: $id) {
      submission {
        id
        status
        abilities {
          canEdit
          canDelete
          canCopy
        }
      }
    }
  }
`;

const COPY = /* GraphQL */ `
  mutation Copy($input: CopySubmissionToDraftInput!) {
    copySubmissionToDraft(input: $input) {
      submission {
        id
        status
      }
    }
  }
`;

const RUNTIME_VERSION = /* GraphQL */ `
  query FormRuntimeVersion($formKey: ID!, $version: Int!) {
    formRuntimeVersion(formKey: $formKey, version: $version) {
      formVersion {
        version
      }
    }
  }
`;

const FIELD_OPTIONS = /* GraphQL */ `
  query FormFieldOptions($input: FormFieldOptionsInput!) {
    formFieldOptions(input: $input) {
      totalCount
    }
  }
`;

const LIST_COLUMNS = /* GraphQL */ `
  query ModuleListColumns($moduleKey: String!) {
    moduleListColumns(moduleKey: $moduleKey) {
      moduleKey
    }
  }
`;

const CREATE_UPLOAD_URL = /* GraphQL */ `
  mutation CreateUploadUrl($input: CreateUploadUrlInput!) {
    createUploadUrl(input: $input) {
      objectPath
    }
  }
`;

const APPLICABLE_FORMS = /* GraphQL */ `
  query ApplicableForms {
    applicableForms {
      moduleKey
      forms {
        key
      }
    }
  }
`;

const PUBLISH_WITH_PERMISSION = /* GraphQL */ `
  mutation Publish($input: PublishFormVersionInput!) {
    publishFormVersion(input: $input) {
      formVersion {
        version
      }
      createdPermission {
        key
        name
      }
    }
  }
`;

interface Abilities {
  canEdit: boolean;
  canDelete: boolean;
  canCopy: boolean;
}

interface CreatedPermission {
  key: string;
  name: string;
}

const FORM_A = "per_form_a";
const FORM_B = "per_form_b";
const FORM_PLAIN = "per_form_plain";
const PLAIN_MODULE = "demo.form";
const createKey = (formKey: string): string =>
  `${MODULE_KEY}.create-${formKey}`;

const fields = [field("title", "text")];

/**
 * 依表單分開新增權限(`docs/concepts/authorization.md`):把 `demo-form` 當成「開啟依表單分開新增權限的測試模組」
 * (底座示範模組本身不開,見 seed 測試),驗證發布建權限、`canCreateWithForm` 的每個入口、租戶客製表單不自動授予。
 */
describe("依表單分開新增權限", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  /** 只有模組 `create`(+ view),沒有任何表單的新增權限 */
  let moduleOnly: FormOperator;
  /** 只有 A 的 `create-<formKey>`(+ view),沒有模組 `create` */
  let formAHolder: FormOperator;
  let wildcard: FormOperator;
  let firstPublish: CreatedPermission | null;
  let plainPublish: CreatedPermission | null;

  /** 開草稿(`baseVersion`;`"existing"` = 用已有的草稿,例:以某版為基底建的新表單)→ 存定義 → 發布,回傳 `createdPermission`。 */
  async function publishWith(
    token: string,
    formKey: string,
    baseVersion: number | null | "existing",
    name?: string,
  ): Promise<CreatedPermission | null> {
    if (name !== undefined) {
      await ok(api, token, UPDATE_FORM, { input: { key: formKey, name } });
    }
    let draftRevision = 0;
    if (baseVersion !== "existing") {
      const draft = await ok<{
        createFormVersionDraft: { formVersion: { draftRevision: number } };
      }>(api, token, CREATE_VERSION_DRAFT, {
        input: { formKey, baseVersion },
      });
      draftRevision = draft.createFormVersionDraft.formVersion.draftRevision;
    }
    const saved = await saveDefinition(
      api,
      token,
      formKey,
      definitionOf(fields),
      draftRevision,
    );
    const published = await ok<{
      publishFormVersion: { createdPermission: CreatedPermission | null };
    }>(api, token, PUBLISH_WITH_PERMISSION, {
      input: {
        formKey,
        expectedDraftRevision: saved.draftRevision,
        changelog: "依表單分開新增權限",
      },
    });
    return published.publishFormVersion.createdPermission;
  }

  /** 申請中心「新申請」裡這個模組的那一組(沒有 = undefined)。 */
  async function applicableGroupOf(operator: FormOperator | undefined) {
    const data = await ok<{
      applicableForms: { moduleKey: string; forms: { key: string }[] }[];
    }>(api, operator?.token ?? "", APPLICABLE_FORMS);
    return data.applicableForms.find((group) => group.moduleKey === MODULE_KEY);
  }

  async function permissionOf(key: string) {
    return connection
      .collection("permissions")
      .findOne<{ name: string; source: string; retiredAt: Date | null }>({
        key,
      });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-per-form-create");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "依表單新增測試租戶" });
    // 沒開依表單分開新增權限的模組:發布不建 create- 權限
    await ok(api, root, CREATE_FORM, {
      input: { key: FORM_PLAIN, moduleKey: PLAIN_MODULE, name: "一般表單" },
    });
    plainPublish = await publishWith(root, FORM_PLAIN, null);
    // seed 宣告的開關(執行期不改);測試直接改資料庫模擬「開啟依表單分開新增權限的模組」
    await connection
      .collection("modules")
      .updateOne({ key: MODULE_KEY }, { $set: { perFormCreate: true } });
    await ok(api, root, CREATE_FORM, {
      input: { key: FORM_A, moduleKey: MODULE_KEY, name: "請假單" },
    });
    firstPublish = await publishWith(root, FORM_A, null);
    await publishNewForm(api, root, FORM_B, definitionOf(fields), "採購單");
    await assignForm(api, root, FORM_A, [tenant]);
    await assignForm(api, root, FORM_B, [tenant]);
    moduleOnly = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create],
    });
    formAHolder = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, createKey(FORM_A)],
    });
    wildcard = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.all],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("發布第 3 步建權限", () => {
    it("開啟依表單分開新增權限的模組:第一次發布建 `<模組>.create-<formKey>`(名稱「<表單名> 新增」,dynamic),回在 `createdPermission`", async () => {
      expect(firstPublish).toEqual({
        key: createKey(FORM_A),
        name: "請假單 新增",
      });
      expect(await permissionOf(createKey(FORM_A))).toMatchObject({
        name: "請假單 新增",
        source: "dynamic",
        retiredAt: null,
      });
    });

    it("沒開依表單分開新增權限的模組:不建、`createdPermission` 為 null", async () => {
      expect(plainPublish).toBeNull();
      expect(
        await permissionOf(`${PLAIN_MODULE}.create-${FORM_PLAIN}`),
      ).toBeNull();
    });

    it("再發布:已存在 → `createdPermission` 為 null;表單改名 → 權限名稱跟著更新;不退役", async () => {
      expect(await publishWith(root, FORM_B, 1)).toBeNull();
      expect(await publishWith(root, FORM_A, 1, "休假單")).toBeNull();
      expect(await permissionOf(createKey(FORM_A))).toMatchObject({
        name: "休假單 新增",
        retiredAt: null,
      });
    });
  });

  describe("入口:只有模組 `create`、沒有表單權限的人每個都被擋", () => {
    it("moduleForms:兩張表單都 `canCreate = false`(清單仍在,給篩選與頁籤模板)", async () => {
      const data = await ok<{
        moduleForms: { key: string; canCreate: boolean }[];
      }>(api, moduleOnly.token, MODULE_FORMS, { moduleKey: MODULE_KEY });
      expect(data.moduleForms).toEqual(
        expect.arrayContaining([
          { key: FORM_A, canCreate: false },
          { key: FORM_B, canCreate: false },
        ]),
      );
    });

    it("新增 API(建草稿、直接送出)→ FORBIDDEN", async () => {
      for (const mutation of [CREATE_FORM_DRAFT, CREATE_AND_SUBMIT]) {
        const result = await call(api, moduleOnly.token, mutation, {
          input: {
            formKey: FORM_A,
            clientRequestId: nextRequestId(),
            values: { title: "不行" },
          },
        });
        expect(codeOf(result)).toBe("FORBIDDEN");
      }
    });

    it("formLookup 版本存取 → FORBIDDEN", async () => {
      const result = await call(api, moduleOnly.token, FORM_LOOKUP, {
        input: { formKey: FORM_A, version: 1, target: { fieldKey: "title" } },
      });
      expect(codeOf(result)).toBe("FORBIDDEN");
    });

    it("自己的草稿:失去表單權限後 abilities `canEdit` / `canDelete` 為 false,存草稿 / 送出 / 刪除 → FORBIDDEN", async () => {
      const former = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.view, M.create, createKey(FORM_A)],
      });
      const draft = await createDraft(api, former.token, FORM_A, {
        title: "我的草稿",
      });
      // 角色管理拿掉這張表單的新增權限(模組 `create` 還在)
      await connection.collection(CORE_RELATIONSHIPS_COLLECTION).deleteOne({
        type: "role_permission",
        firstId: former.roleId,
        secondId: await findPermissionIdByKey(connection, createKey(FORM_A)),
      });
      const view = await ok<{
        formSubmission: { submission: { abilities: Abilities } };
      }>(api, former.token, ABILITIES, { id: draft.id });
      expect(view.formSubmission.submission.abilities).toMatchObject({
        canEdit: false,
        canDelete: false,
      });
      const attempts = [
        call(api, former.token, SAVE_FORM_DRAFT, {
          input: {
            id: draft.id,
            expectedEditVersion: draft.editVersion,
            values: { title: "改" },
          },
        }),
        call(api, former.token, SUBMIT, {
          input: { id: draft.id, expectedEditVersion: draft.editVersion },
        }),
        call(api, former.token, DELETE_SUBMISSION, { input: { id: draft.id } }),
      ];
      for (const result of await Promise.all(attempts)) {
        expect(codeOf(result)).toBe("FORBIDDEN");
      }
    });

    it("複製為新單:abilities `canCopy` 為 false、複製 → FORBIDDEN;有表單權限的人可以", async () => {
      const source = await createSubmitted(api, wildcard.token, FORM_A, {
        title: "要作廢的單",
      });
      // 作廢要綁流程;這裡只驗權限判斷,直接把狀態改成已作廢
      await connection
        .collection("form_submissions")
        .updateOne(
          { _id: new Types.ObjectId(source.id) },
          { $set: { status: "voided", voidedAt: new Date() } },
        );
      const asModuleOnly = await ok<{
        formSubmission: { submission: { abilities: Abilities } };
      }>(api, moduleOnly.token, ABILITIES, { id: source.id });
      expect(asModuleOnly.formSubmission.submission.abilities.canCopy).toBe(
        false,
      );
      expect(
        codeOf(
          await call(api, moduleOnly.token, COPY, {
            input: { id: source.id, clientRequestId: nextRequestId() },
          }),
        ),
      ).toBe("FORBIDDEN");
      const asHolder = await ok<{
        formSubmission: { submission: { abilities: Abilities } };
      }>(api, formAHolder.token, ABILITIES, { id: source.id });
      expect(asHolder.formSubmission.submission.abilities.canCopy).toBe(true);
    });
  });

  describe("有表單權限的人", () => {
    it("只有 A 的 `create-<formKey>`:moduleForms 只有 A 可新增;A 建得了、B 被擋", async () => {
      const data = await ok<{
        moduleForms: { key: string; canCreate: boolean }[];
      }>(api, formAHolder.token, MODULE_FORMS, { moduleKey: MODULE_KEY });
      expect(data.moduleForms).toEqual(
        expect.arrayContaining([
          { key: FORM_A, canCreate: true },
          { key: FORM_B, canCreate: false },
        ]),
      );
      const draft = await createDraft(api, formAHolder.token, FORM_A, {
        title: "可以",
      });
      expect(draft.status).toBe("DRAFT");
      const blocked = await call(api, formAHolder.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: FORM_B,
          clientRequestId: nextRequestId(),
          values: {},
        },
      });
      expect(codeOf(blocked)).toBe("FORBIDDEN");
    });

    it("模組 `*` 自然包含每張表單的新增權限", async () => {
      const data = await ok<{
        moduleForms: { key: string; canCreate: boolean }[];
      }>(api, wildcard.token, MODULE_FORMS, { moduleKey: MODULE_KEY });
      expect(
        data.moduleForms
          .filter((form) => [FORM_A, FORM_B].includes(form.key))
          .every((form) => form.canCreate),
      ).toBe(true);
      const draft = await createDraft(api, wildcard.token, FORM_B, {
        title: "萬用",
      });
      expect(draft.status).toBe("DRAFT");
    });
  });

  describe("租戶複製的客製表單", () => {
    it("發布產生新權限、不自動授予任何角色;回 `createdPermission` 給發布成功畫面提示", async () => {
      const designer = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [F.view, F.create, F.edit],
        moduleKeys: FORMS_MODULES,
      });
      await ok(api, designer.token, FORK_FORM, {
        input: {
          sourceKey: FORM_A,
          sourceVersion: 2,
          key: "per_form_a_custom",
          name: "租戶請假單",
        },
      });
      const created = await publishWith(
        designer.token,
        "per_form_a_custom",
        "existing",
      );
      expect(created).toEqual({
        key: createKey("per_form_a_custom"),
        name: "租戶請假單 新增",
      });
      const permissionId = await findPermissionIdByKey(
        connection,
        createKey("per_form_a_custom"),
      );
      expect(
        await connection
          .collection(CORE_RELATIONSHIPS_COLLECTION)
          .countDocuments({ type: "role_permission", secondId: permissionId }),
      ).toBe(0);
      // 只有模組 `create` 的人仍不能用它新增
      const data = await ok<{
        moduleForms: { key: string; canCreate: boolean }[];
      }>(api, moduleOnly.token, MODULE_FORMS, { moduleKey: MODULE_KEY });
      expect(data.moduleForms).toContainEqual({
        key: "per_form_a_custom",
        canCreate: false,
      });
    });
  });

  describe("模組層與定義讀取的入口(沒有 view / edit,只看新增資格)", () => {
    /** 只有模組 `create`(沒有 view / edit、沒有表單權限) */
    let createOnly: FormOperator;
    /** 只有 A 的 `create-<formKey>` */
    let formOnly: FormOperator;

    beforeAll(async () => {
      createOnly = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.create],
      });
      formOnly = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [createKey(FORM_A)],
      });
    }, HOOK_TIMEOUT_MS);

    it("formRuntimeVersion:只有模組 `create` → FORBIDDEN;只有 `create-<formKey>` → 讀得到", async () => {
      const variables = { formKey: FORM_A, version: 1 };
      expect(
        codeOf(await call(api, createOnly.token, RUNTIME_VERSION, variables)),
      ).toBe("FORBIDDEN");
      const data = await ok<{
        formRuntimeVersion: { formVersion: { version: number } };
      }>(api, formOnly.token, RUNTIME_VERSION, variables);
      expect(data.formRuntimeVersion.formVersion.version).toBe(1);
    });

    it("formFieldOptions:只有模組 `create` → FORBIDDEN;只有 `create-<formKey>` → 過了權限(欄位不是選項欄位,另回非權限錯誤)", async () => {
      const input = { formKey: FORM_A, version: 1, fieldKey: "title" };
      expect(
        codeOf(await call(api, createOnly.token, FIELD_OPTIONS, { input })),
      ).toBe("FORBIDDEN");
      expect(
        codeOf(await call(api, formOnly.token, FIELD_OPTIONS, { input })),
      ).not.toBe("FORBIDDEN");
    });

    it("moduleListColumns(模組層):只有模組 `create` → FORBIDDEN;持任一張表單的 `create-<formKey>` → 讀得到", async () => {
      const variables = { moduleKey: MODULE_KEY };
      expect(
        codeOf(await call(api, createOnly.token, LIST_COLUMNS, variables)),
      ).toBe("FORBIDDEN");
      const data = await ok<{ moduleListColumns: { moduleKey: string } }>(
        api,
        formOnly.token,
        LIST_COLUMNS,
        variables,
      );
      expect(data.moduleListColumns.moduleKey).toBe(MODULE_KEY);
    });

    it("表單附件上傳網址:只有模組 `create` → FORBIDDEN;只有 `create-<formKey>` → 拿得到", async () => {
      const input = {
        purpose: "FORM_ATTACHMENT",
        contentType: "application/pdf",
        size: 1000,
      };
      expect(
        codeOf(await call(api, createOnly.token, CREATE_UPLOAD_URL, { input })),
      ).toBe("FORBIDDEN");
      const data = await ok<{ createUploadUrl: { objectPath: string } }>(
        api,
        formOnly.token,
        CREATE_UPLOAD_URL,
        { input },
      );
      expect(data.createUploadUrl.objectPath).toMatch(/^form\//);
    });

    it("申請中心「新申請」:只列有新增資格的表單;只有模組 `create` 的人看不到這個模組", async () => {
      // 綁流程的表單才會出現在新申請(放在最後:A 綁了流程後送出會走流程)
      for (const formKey of [FORM_A, FORM_B]) {
        const form = await connection
          .collection("forms")
          .findOne<{ _id: Types.ObjectId }>({ key: formKey });
        if (!form) {
          throw new Error(`表單 ${formKey} 不存在`);
        }
        await connection.collection("business_relationships").insertOne({
          tenantId: tenant,
          type: "org_form_workflow",
          firstId: tenant,
          secondId: form._id,
          thirdId: new Types.ObjectId(),
          meta: {},
          deletedAt: null,
        });
      }
      // 申請中心本身要 `apply-center.view`;業務模組的權限各自不同
      const [onlyModuleCreate, onlyA, all] = await Promise.all(
        [[M.view, M.create], [createKey(FORM_A)], [M.all]].map(
          (permissionKeys) =>
            createOperator(api, connection, {
              orgId: tenant,
              moduleKeys: [MODULE_KEY, "apply-center"],
              permissionKeys: ["apply-center.view", ...permissionKeys],
            }),
        ),
      );

      expect(await applicableGroupOf(onlyModuleCreate)).toBeUndefined();
      const groupA = await applicableGroupOf(onlyA);
      expect(groupA?.forms).toEqual([{ key: FORM_A }]);
      const groupAll = await applicableGroupOf(all);
      expect(groupAll?.forms.map((form) => form.key)).toEqual(
        expect.arrayContaining([FORM_A, FORM_B]),
      );
    });
  });
});
