import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Module } from "@nestjs/common";
import { Query, Resolver } from "@nestjs/graphql";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { RequirePermission } from "../../permission/require-permission.decorator";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  F,
  FORK_FORM,
  FORM,
  FORMS,
  FORMS_MODULES,
  FORM_LOOKUP,
  FORM_SUBMISSION,
  FORM_TEST_TIMEOUT_MS,
  FORM_VERSION,
  type FormOperator,
  type FormRow,
  M,
  MODULE_FORMS,
  MODULE_KEY,
  REVOKE,
  SET_TENANT_ENABLED,
  UPDATE_FORM,
  VALIDATE_VERSION,
  type VersionRow,
  assignForm,
  call,
  codeOf,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  getForm,
  ok,
  publishDraft,
  publishNewForm,
  rootToken,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

/** 租戶乙的客製表單(下方「別租戶的客製表單」一組測試建立)與它的受保護欄位、依表單新增權限。 */
const B_FORM = "shared_b_custom";
const B_SECRET_SHOW = showKey(B_FORM, "b_secret");
const B_FORM_CREATE = `${MODULE_KEY}.create-${B_FORM}`;

/** 測試專用探針:`@RequirePermission` 要求乙客製表單的欄位級權限(守門對別租戶動態權限的判斷)。 */
@Resolver()
class ForeignPermissionProbeResolver {
  @RequirePermission(B_SECRET_SHOW)
  @Query(() => Boolean, { name: "foreignPermissionProbe" })
  probe(): boolean {
    return true;
  }
}

@Module({ providers: [ForeignPermissionProbeResolver] })
class ForeignPermissionProbeModule {}

const FOREIGN_PERMISSION_PROBE = /* GraphQL */ `
  query ForeignPermissionProbe {
    foreignPermissionProbe
  }
`;

const ME_PERMISSION_KEYS = /* GraphQL */ `
  query MePermissionKeys {
    me {
      modules {
        permissions
      }
    }
  }
`;

const ROLE_MATRIX = /* GraphQL */ `
  query RoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      modules {
        key
        permissions {
          key
        }
      }
    }
  }
`;

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation SaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      shrinkOnly
    }
  }
`;

const FORM_RUNTIME_VERSION = /* GraphQL */ `
  query FormRuntimeVersion($formKey: ID!, $version: Int!) {
    formRuntimeVersion(formKey: $formKey, version: $version) {
      formVersion {
        version
      }
    }
  }
`;

/**
 * 表單的可見、分派、啟用、客製副本(Spec 6a §3、§10「表單」):真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("表單:副本、分派 / 啟用 / 收回的交集、租戶邊界", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let adminA: FormOperator;
  let adminB: FormOperator;
  let staffA: FormOperator;
  let staffB: FormOperator;
  /** A 底下的部門使用者:可見範圍不含租戶頂層。 */
  let deptStaffA: FormOperator;

  const simple = definitionOf([field("title", "text"), field("qty", "number")]);

  async function moduleFormKeys(token: string): Promise<string[]> {
    const data = await ok<{ moduleForms: { key: string }[] }>(
      api,
      token,
      MODULE_FORMS,
      { moduleKey: MODULE_KEY },
    );
    return data.moduleForms
      .map((form) => form.key)
      .toSorted((a, b) => a.localeCompare(b));
  }

  /** 以 `baseVersion` 開一份草稿,回它的 draftRevision。 */
  async function draftRevisionOf(
    token: string,
    formKey: string,
    baseVersion: number,
  ): Promise<number> {
    const data = await ok<{
      createFormVersionDraft: { formVersion: VersionRow };
    }>(api, token, CREATE_DRAFT, { input: { formKey, baseVersion } });
    return data.createFormVersionDraft.formVersion.draftRevision;
  }

  async function listedKeys(token: string): Promise<string[]> {
    const data = await ok<{ forms: { items: FormRow[] } }>(api, token, FORMS, {
      input: { moduleKey: MODULE_KEY, pageSize: 100 },
    });
    return data.forms.items
      .map((form) => form.key)
      .toSorted((a, b) => a.localeCompare(b));
  }

  /** 某位操作者 `me.modules` 裡的全部權限 key。 */
  async function mePermissionKeys(token: string): Promise<string[]> {
    const data = await ok<{ me: { modules: { permissions: string[] }[] } }>(
      api,
      token,
      ME_PERMISSION_KEYS,
      {},
    );
    return data.me.modules.flatMap((module) => module.permissions);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-forms", {}, [
      ForeignPermissionProbeModule,
    ]);
    connection = api.connection;
    root = await rootToken(api);
    tenantA = await createOrg(connection, { name: "租戶甲" });
    tenantB = await createOrg(connection, { name: "租戶乙" });
    const deptA = await createOrg(connection, {
      name: "甲的部門",
      parentId: tenantA,
    });
    const adminKeys = [F.all, M.all];
    adminA = await createOperator(api, connection, {
      orgId: tenantA,
      permissionKeys: adminKeys,
      moduleKeys: [...FORMS_MODULES, MODULE_KEY],
    });
    adminB = await createOperator(api, connection, {
      orgId: tenantB,
      permissionKeys: adminKeys,
      moduleKeys: [...FORMS_MODULES, MODULE_KEY],
    });
    const staffKeys = [M.view, M.create];
    staffA = await createOperator(api, connection, {
      orgId: tenantA,
      permissionKeys: staffKeys,
    });
    staffB = await createOperator(api, connection, {
      orgId: tenantB,
      permissionKeys: staffKeys,
    });
    deptStaffA = await createOperator(api, connection, {
      orgId: deptA,
      ownerOrgId: tenantA,
      permissionKeys: staffKeys,
    });

    await publishNewForm(api, root, "shared_a", simple, "共用甲");
    await publishNewForm(api, root, "shared_b", simple, "共用乙");
    await assignForm(api, root, "shared_a", [tenantA]);
    await assignForm(api, root, "shared_b", [tenantB]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("分派的交集:A 只看得到分派給 A 的、B 只看得到 B 的;root 看全部共用表單", async () => {
    expect(await moduleFormKeys(staffA.token)).toEqual(["shared_a"]);
    expect(await moduleFormKeys(staffB.token)).toEqual(["shared_b"]);
    expect(await moduleFormKeys(root)).toEqual(
      expect.arrayContaining(["shared_a", "shared_b"]),
    );
    // 設計端清單同一條判準;root 視角附分派清單
    expect(await listedKeys(adminA.token)).toEqual(["shared_a"]);
    const shared = await getForm(api, root, "shared_a");
    expect(shared.assignments).toEqual([
      { tenantOrgId: String(tenantA), enabled: true },
    ]);
  });

  it("部門使用者(可見範圍不含租戶頂層)也查得到本租戶的 org_form", async () => {
    expect(await moduleFormKeys(deptStaffA.token)).toEqual(["shared_a"]);
  });

  it("跨租戶查不到:別租戶的表單讀不到(NOT_FOUND)、不能以它為基底", async () => {
    const read = await call(api, adminA.token, FORM, { key: "shared_b" });
    expect(codeOf(read)).toBe("NOT_FOUND");
    const fork = await call(api, adminA.token, FORK_FORM, {
      input: {
        sourceKey: "shared_b",
        sourceVersion: 1,
        key: "stolen",
        name: "偷來的",
      },
    });
    expect(codeOf(fork)).toBe("NOT_FOUND");
    const create = await call(api, staffA.token, CREATE_FORM, {
      input: { key: "nope", moduleKey: MODULE_KEY, name: "x" },
    });
    expect(codeOf(create)).toBe("FORBIDDEN");
  });

  it("租戶不能建共用表單、不能改共用表單、不能分派(站在根組織才行)", async () => {
    const create = await call(api, adminA.token, CREATE_FORM, {
      input: { key: "tenant_made", moduleKey: MODULE_KEY, name: "租戶建的" },
    });
    expect(extensionsOf(create).reason).toBe("ROOT_ONLY");
    const draft = await call(api, adminA.token, CREATE_DRAFT, {
      input: { formKey: "shared_a", baseVersion: 1 },
    });
    expect(extensionsOf(draft).reason).toBe("NOT_FORM_OWNER");
    const assign = await call(api, adminA.token, REVOKE, {
      input: { formKey: "shared_a", tenantOrgId: String(tenantA) },
    });
    expect(extensionsOf(assign).reason).toBe("ROOT_ONLY");
    const sharedForTenant = await getForm(api, adminA.token, "shared_a");
    expect(sharedForTenant.abilities).toEqual({
      canEdit: false,
      canAssign: false,
      canSetEnabled: true,
      canFork: true,
    });
  });

  it("forms.key 建立後不可改;key 格式與撞名擋下", async () => {
    await ok(api, root, CREATE_FORM, {
      input: { key: "immutable_key", moduleKey: MODULE_KEY, name: "原名" },
    });
    const updated = await ok<{ updateForm: { form: FormRow } }>(
      api,
      root,
      UPDATE_FORM,
      { input: { key: "immutable_key", name: "新名" } },
    );
    expect(updated.updateForm.form).toMatchObject({
      key: "immutable_key",
      name: "新名",
    });
    const duplicated = await call(api, root, CREATE_FORM, {
      input: { key: "immutable_key", moduleKey: MODULE_KEY, name: "撞名" },
    });
    expect(codeOf(duplicated)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(duplicated).fields).toEqual(["key"]);
    const badFormat = await call(api, root, CREATE_FORM, {
      input: { key: "Bad-Key", moduleKey: MODULE_KEY, name: "格式錯" },
    });
    expect(extensionsOf(badFormat).fields).toEqual(["key"]);
    const notFormModule = await call(api, root, CREATE_FORM, {
      input: { key: "wrong_module", moduleKey: "demo.sample-two", name: "x" },
    });
    expect(extensionsOf(notFormModule).fields).toEqual(["moduleKey"]);
  });

  it("客製副本:以分派來的共用表單某版為基底 → 同模組、記 forkedFrom、複製定義成草稿、自動建本租戶的 org_form", async () => {
    const forked = await ok<{ forkForm: { form: FormRow } }>(
      api,
      adminA.token,
      FORK_FORM,
      {
        input: {
          sourceKey: "shared_a",
          sourceVersion: 1,
          key: "shared_a_tenant",
          name: "共用甲(甲版)",
        },
      },
    );
    expect(forked.forkForm.form).toMatchObject({
      moduleKey: MODULE_KEY,
      isShared: false,
      ownerOrgId: String(tenantA),
      forkedFrom: { formKey: "shared_a", version: 1 },
      currentVersion: null,
      hasDraft: true,
      tenantEnabled: true,
      abilities: { canEdit: true, canAssign: false },
    });
    const draft = await ok<{ formVersion: { formVersion: VersionRow } }>(
      api,
      adminA.token,
      FORM_VERSION,
      { formKey: "shared_a_tenant" },
    );
    expect(
      draft.formVersion.formVersion.fields.map((item) => item.key),
    ).toEqual(["title", "qty"]);
    // 發布前不可新增;發布後只有 A 看得到
    expect(await moduleFormKeys(staffA.token)).toEqual(["shared_a"]);
    await publishDraft(api, adminA.token, "shared_a_tenant", simple, 0);
    expect(await moduleFormKeys(staffA.token)).toEqual([
      "shared_a",
      "shared_a_tenant",
    ]);
    expect(await moduleFormKeys(staffB.token)).toEqual(["shared_b"]);
    const other = await call(api, adminB.token, FORM, {
      key: "shared_a_tenant",
    });
    expect(codeOf(other)).toBe("NOT_FOUND");
    // 客製表單只有該租戶看得到:root 也讀不到、不能以它為基底、清單不列
    const rootView = await call(api, root, FORM, { key: "shared_a_tenant" });
    expect(codeOf(rootView)).toBe("NOT_FOUND");
    const rootFork = await call(api, root, FORK_FORM, {
      input: {
        sourceKey: "shared_a_tenant",
        sourceVersion: 1,
        key: "root_copy",
        name: "root 的副本",
      },
    });
    expect(codeOf(rootFork)).toBe("NOT_FOUND");
    expect(await listedKeys(root)).not.toContain("shared_a_tenant");
  });

  describe("別租戶的客製表單:執行端與權限矩陣都當它不存在", () => {
    beforeAll(async () => {
      // B 以分派來的共用表單為基底建客製表單,加一個受保護欄位後發布
      await ok(api, adminB.token, FORK_FORM, {
        input: {
          sourceKey: "shared_b",
          sourceVersion: 1,
          key: B_FORM,
          name: "乙的客製",
        },
      });
      await publishDraft(
        api,
        adminB.token,
        B_FORM,
        definitionOf([
          field("title", "text"),
          field("b_secret", "text", {
            label: "乙的機密欄",
            permission: { show: true, edit: false },
          }),
          field("b_ref", "reference", {
            source: { provider: "user", labelField: "name" },
          }),
        ]),
        0,
      );
      // 依表單新增權限(B9b 建立;這裡直接寫一筆,只驗解析與過濾認得 `create-`)
      const module = await connection
        .collection("modules")
        .findOne<{ _id: Types.ObjectId }>({ key: MODULE_KEY });
      if (!module) {
        throw new Error(`測試資料庫沒有模組 ${MODULE_KEY}`);
      }
      await connection.collection("permissions").insertOne({
        key: B_FORM_CREATE,
        moduleId: module._id,
        name: "乙的客製 新增",
        enabled: true,
        isSystem: false,
        settings: {},
        source: "dynamic",
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      // 測試直接寫入的依表單新增權限(B9b 未實作前沒有流程會建它),不留給後續測試
      await connection
        .collection("permissions")
        .deleteOne({ key: B_FORM_CREATE });
    }, HOOK_TIMEOUT_MS);

    it("me.modules:A 持表單模組 `*` 也拿不到 B 客製表單的動態權限;B 自己拿得到", async () => {
      const ownKeys = await mePermissionKeys(adminB.token);
      expect(ownKeys).toEqual(
        expect.arrayContaining([B_SECRET_SHOW, B_FORM_CREATE]),
      );
      const keysOfA = await mePermissionKeys(adminA.token);
      expect(keysOfA).toContain(M.all);
      expect(keysOfA.filter((key) => key.includes(B_FORM))).toEqual([]);
      // 根組織只認共用表單的動態權限
      const rootKeys = await mePermissionKeys(root);
      expect(rootKeys.filter((key) => key.includes(B_FORM))).toEqual([]);
    });

    it("@RequirePermission:別租戶的動態權限一律拒絕(持 `*` 也一樣);本租戶放行", async () => {
      const denied = await call(
        api,
        adminA.token,
        FOREIGN_PERMISSION_PROBE,
        {},
      );
      expect(codeOf(denied)).toBe("FORBIDDEN");
      const allowed = await call(
        api,
        adminB.token,
        FOREIGN_PERMISSION_PROBE,
        {},
      );
      expect(allowed.errors).toBeUndefined();
    });

    it("A 用 B 的客製表單 key:formRuntimeVersion / formLookup 都 NOT_FOUND,欄位目錄不透露它的欄位", async () => {
      const runtime = await call(api, staffA.token, FORM_RUNTIME_VERSION, {
        formKey: B_FORM,
        version: 1,
      });
      expect(codeOf(runtime)).toBe("NOT_FOUND");
      const lookup = await call(api, staffA.token, FORM_LOOKUP, {
        input: { formKey: B_FORM, version: 1, target: { fieldKey: "b_ref" } },
      });
      expect(codeOf(lookup)).toBe("NOT_FOUND");
      // A 的設計者在自己的草稿引用 B 的表單當來源:B 的欄位一律「沒有這個欄位」
      const report = await ok<{
        validateFormVersion: {
          errors: { code: string; location: Record<string, unknown> }[];
        };
      }>(api, adminA.token, VALIDATE_VERSION, {
        input: {
          formKey: "shared_a_tenant",
          ...definitionOf([
            field("title", "text"),
            field("pick", "reference", {
              source: {
                provider: "form_submission",
                formKey: B_FORM,
                labelField: "b_ref",
              },
            }),
          ]),
        },
      });
      expect(report.validateFormVersion.errors).toContainEqual(
        expect.objectContaining({
          code: "LOOKUP_UNKNOWN_FIELD",
          location: expect.objectContaining({ fieldKey: "pick" }),
        }),
      );
      // 對照:B 自己讀得到
      const own = await call(api, adminB.token, FORM_RUNTIME_VERSION, {
        formKey: B_FORM,
        version: 1,
      });
      expect(own.errors).toBeUndefined();
    });

    it("權限矩陣:A 的矩陣只列自己的欄位級權限;存 B 的 key 被拒", async () => {
      await publishDraft(
        api,
        adminA.token,
        "shared_a_tenant",
        definitionOf([
          field("title", "text"),
          field("qty", "number"),
          field("a_secret", "text", {
            permission: { show: true, edit: false },
          }),
        ]),
        await draftRevisionOf(adminA.token, "shared_a_tenant", 1),
      );
      // A 租戶裡能編角色矩陣、持示範表單 `*` 的管理員(`*` 會展開成該模組全部權限,含 B 的)
      const roleAdminA = await createOperator(api, connection, {
        orgId: tenantA,
        moduleKeys: ["system", "system.role-manager", MODULE_KEY],
        permissionKeys: ["system.role-manager.*", M.all],
      });
      const matrix = await ok<{
        roleMatrix: {
          modules: { key: string; permissions: { key: string }[] }[];
        };
      }>(api, roleAdminA.token, ROLE_MATRIX, { roleId: String(staffA.roleId) });
      const keys = matrix.roleMatrix.modules
        .find((node) => node.key === MODULE_KEY)
        ?.permissions.map((permission) => permission.key);
      expect(keys).toContain(showKey("shared_a_tenant", "a_secret"));
      expect(keys).not.toContain(showKey(B_FORM, "b_secret"));
      expect(keys).not.toContain(B_FORM_CREATE);
      const denied = await call(api, roleAdminA.token, SAVE_ROLE_MATRIX, {
        input: {
          roleId: String(staffA.roleId),
          moduleKeys: [MODULE_KEY],
          permissionKeys: [M.view, M.create, showKey(B_FORM, "b_secret")],
        },
      });
      expect(codeOf(denied)).toBe("ROLE_OUT_OF_REACH");
    });
  });

  it("租戶停用 → 不能新增但設計端仍列出(標停用);收回分派 → 不列、不能新增,歷史提交照常可讀", async () => {
    await publishNewForm(api, root, "shared_toggle", simple, "開關");
    await assignForm(api, root, "shared_toggle", [tenantA]);
    const history = await createSubmitted(api, staffA.token, "shared_toggle", {
      title: "停用前的單",
      qty: "1",
    });

    await ok(api, adminA.token, SET_TENANT_ENABLED, {
      input: { formKey: "shared_toggle", enabled: false },
    });
    expect(await moduleFormKeys(staffA.token)).not.toContain("shared_toggle");
    const listed = await ok<{ forms: { items: FormRow[] } }>(
      api,
      adminA.token,
      FORMS,
      { input: { keyword: "shared_toggle" } },
    );
    expect(listed.forms.items[0]).toMatchObject({
      key: "shared_toggle",
      tenantEnabled: false,
    });

    await ok(api, adminA.token, SET_TENANT_ENABLED, {
      input: { formKey: "shared_toggle", enabled: true },
    });
    expect(await moduleFormKeys(staffA.token)).toContain("shared_toggle");

    await ok(api, root, REVOKE, {
      input: { formKey: "shared_toggle", tenantOrgId: String(tenantA) },
    });
    expect(await moduleFormKeys(staffA.token)).not.toContain("shared_toggle");
    expect(await listedKeys(adminA.token)).not.toContain("shared_toggle");
    const read = await ok<{ formSubmission: { submission: { id: string } } }>(
      api,
      staffA.token,
      FORM_SUBMISSION,
      { id: history.id },
    );
    expect(read.formSubmission.submission.id).toBe(history.id);
  });

  it("以任一版本為基底建新表單:草稿與未發布的版本不能當基底", async () => {
    await publishNewForm(api, root, "base_src", simple);
    const bad = await call(api, root, FORK_FORM, {
      input: {
        sourceKey: "base_src",
        sourceVersion: 9,
        key: "base_copy",
        name: "副本",
      },
    });
    expect(extensionsOf(bad).fields).toEqual(["baseVersion"]);
    // root 以共用表單為基底 → 仍是共用表單(之後再分派)
    const copied = await ok<{ forkForm: { form: FormRow } }>(
      api,
      root,
      FORK_FORM,
      {
        input: {
          sourceKey: "base_src",
          sourceVersion: 1,
          key: "base_copy",
          name: "副本",
        },
      },
    );
    expect(copied.forkForm.form).toMatchObject({
      isShared: true,
      forkedFrom: { formKey: "base_src", version: 1 },
    });
  });
});
