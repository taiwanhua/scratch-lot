import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { dataScopeTargetIdOf } from "../../data-scope/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { findPermissionIdByKey } from "../../permission/test-support/fixtures";
import {
  DELETE_RETIRED_PERMISSION,
  FORK_FORM,
  FORM_SUBMISSION,
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  PREVIEW_VERSION,
  RETIRED_PERMISSIONS,
  SAVE_FORM_DRAFT,
  type SubmissionRow,
  UPDATE_SUBMISSION,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  editKey,
  extensionsOf,
  field,
  getSubmission,
  ok,
  publishDefinition,
  publishNewForm,
  rootToken,
  saveDefinition,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const MODULE_TREE = /* GraphQL */ `
  query ModuleTree {
    moduleTree {
      key
      permissions {
        key
      }
      children {
        key
        permissions {
          key
        }
      }
    }
  }
`;

const SAVE_DATA_SCOPE_RULE = /* GraphQL */ `
  mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
    saveDataScopeRule(input: $input) {
      rule {
        collection
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

interface MatrixNode {
  key: string;
  permissions: { key: string }[];
}

interface TreeNode {
  key: string;
  permissions: { key: string }[];
  children?: TreeNode[];
}

interface RetiredItem {
  key: string;
  name: string;
  formKey: string;
  fieldKey: string;
  action: string;
  usage: {
    draftCount: number;
    draftVersions: number[];
    completedCount: number;
    completedVersions: number[];
  };
}

/**
 * 欄位級權限(Spec 6a §5「欄位級權限的四種組合」「受保護欄位的配套」、§6「權限不存在時的判定」「root 清理」、
 * §10「權限」):投影、守門、依賴鏈、權限被刪、退役清理三層;資料範圍依 moduleKey 與建立者讀自己的單。
 */
describe("表單的欄位級權限:投影 / 守門 / 依賴鏈 / 權限被刪 / 退役清理", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let otherOrg: Types.ObjectId;
  let plain: FormOperator;
  let priceViewer: FormOperator;
  let taxViewer: FormOperator;
  let wildcard: FormOperator;
  let memoEditor: FormOperator;
  let submission: SubmissionRow;

  const FORM = "priced";

  const fields = [
    field("title", "text"),
    field("qty", "number"),
    field("unit_price", "number", {
      precision: 2,
      permission: { show: true, edit: false },
    }),
    field("total", "number", {
      precision: 2,
      valueSource: {
        kind: "computed",
        expr: { "*": [{ var: "qty" }, { var: "unit_price" }] },
      },
    }),
    field("total_tax", "number", {
      precision: 2,
      valueSource: {
        kind: "computed",
        expr: { "*": [{ var: "total" }, 1.05] },
      },
      permission: { show: true, edit: false },
    }),
    field("memo", "text", { permission: { show: false, edit: true } }),
  ];

  function valueStates(row: SubmissionRow): Record<string, unknown> {
    return Object.fromEntries(
      ["unit_price", "total", "total_tax", "memo"].map((key) => [
        key,
        row.values[key],
      ]),
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-permissions");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "權限租戶" });
    otherOrg = await createOrg(connection, { name: "旁邊的租戶" });
    await publishNewForm(api, root, FORM, definitionOf(fields));
    await assignForm(api, root, FORM, [tenant]);
    const base = [M.view, M.create, M.edit];
    plain = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: base,
    });
    priceViewer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [...base, showKey(FORM, "unit_price")],
    });
    taxViewer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [
        ...base,
        showKey(FORM, "unit_price"),
        showKey(FORM, "total_tax"),
      ],
    });
    wildcard = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.all],
    });
    memoEditor = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [...base, editKey(FORM, "memo")],
    });
    // 由全部欄位都寫得動的人建一筆(看得到單價、有 edit-memo)
    const author = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [
        ...base,
        showKey(FORM, "unit_price"),
        editKey(FORM, "memo"),
      ],
    });
    submission = await createSubmitted(api, author.token, FORM, {
      title: "有單價的單",
      qty: 2,
      unit_price: "10",
      memo: "一開始的備註",
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it('投影:沒有 show → "[redacted]";計算欄位 = 自身 show + 依賴鏈(間接洩漏擋下)', async () => {
    expect(
      valueStates(await getSubmission(api, plain.token, submission.id)),
    ).toEqual({
      unit_price: "[redacted]",
      total: "[redacted]",
      total_tax: "[redacted]",
      memo: "一開始的備註",
    });
    expect(
      valueStates(await getSubmission(api, priceViewer.token, submission.id)),
    ).toEqual({
      unit_price: "10.00",
      total: "20.00",
      total_tax: "[redacted]",
      memo: "一開始的備註",
    });
    expect(
      valueStates(await getSubmission(api, taxViewer.token, submission.id)),
    ).toEqual({
      unit_price: "10.00",
      total: "20.00",
      total_tax: "21.00",
      memo: "一開始的備註",
    });
    const plainView = await getSubmission(api, plain.token, submission.id);
    expect(
      plainView.fieldStates
        .filter((state) => state.redacted)
        .map((state) => state.key),
    ).toEqual(["unit_price", "total", "total_tax"]);
    // 列表同一套投影
    const list = await ok<{ formSubmissions: { items: SubmissionRow[] } }>(
      api,
      plain.token,
      FORM_SUBMISSIONS,
      { input: { moduleKey: MODULE_KEY } },
    );
    expect(
      list.formSubmissions.items.find((item) => item.id === submission.id)
        ?.values.total,
    ).toBe("[redacted]");
  });

  it("持有模組 `*` 的角色自動涵蓋動態權限(看得到受保護欄位)", async () => {
    expect(
      valueStates(await getSubmission(api, wildcard.token, submission.id)),
    ).toMatchObject({ unit_price: "10.00", total_tax: "21.00" });
  });

  it("守門:只有 `edit-…` 欄位要那把權限;canEditField 依權限算好", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    expect(view.abilities.canEditField).toEqual(["title", "qty"]);
    const denied = await call(api, plain.token, UPDATE_SUBMISSION, {
      input: {
        id: submission.id,
        expectedEditVersion: view.editVersion,
        expectedRevision: view.revision,
        values: { ...view.values, memo: "我沒有 edit-memo" },
      },
    });
    expect(codeOf(denied)).toBe("FORBIDDEN");
    expect(extensionsOf(denied).reason).toBe("FIELD_FORBIDDEN");

    const editorView = await getSubmission(
      api,
      memoEditor.token,
      submission.id,
    );
    expect(editorView.abilities.canEditField).toEqual(["title", "qty", "memo"]);
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, memoEditor.token, UPDATE_SUBMISSION, {
      input: {
        id: submission.id,
        expectedEditVersion: editorView.editVersion,
        expectedRevision: editorView.revision,
        // 看不到的單價原樣送回遮蔽字串:算沒動,值保留
        values: { ...editorView.values, memo: "有權限改備註" },
      },
    });
    expect(updated.updateFormSubmission.submission.values.memo).toBe(
      "有權限改備註",
    );
    const afterUpdate = await getSubmission(
      api,
      taxViewer.token,
      submission.id,
    );
    expect(afterUpdate.values).toMatchObject({
      unit_price: "10.00",
      total: "20.00",
    });
  });

  it("草稿存無權值也 403(不能先存進草稿再送出繞過)", async () => {
    const draft = await createDraft(api, plain.token, FORM, { title: "草稿" });
    const sneaky = await call(api, plain.token, SAVE_FORM_DRAFT, {
      input: {
        id: draft.id,
        expectedEditVersion: draft.editVersion,
        values: { title: "草稿", unit_price: "1" },
      },
    });
    expect(codeOf(sneaky)).toBe("FORBIDDEN");
    expect(extensionsOf(sneaky).reason).toBe("FIELD_FORBIDDEN");
  });

  it("權限列被刪 → 該欄只有 root(超級管理員)看得到,模組 `*` 不放行", async () => {
    await publishNewForm(
      api,
      root,
      "deleted_perm",
      definitionOf([
        field("title", "text"),
        field("secret", "text", { permission: { show: true, edit: false } }),
      ]),
    );
    await assignForm(api, root, "deleted_perm", [tenant]);
    const holder = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, showKey("deleted_perm", "secret")],
    });
    const created = await createSubmitted(api, holder.token, "deleted_perm", {
      title: "有秘密",
      secret: "機密",
    });
    const beforeDelete = await getSubmission(api, wildcard.token, created.id);
    expect(beforeDelete.values.secret).toBe("機密");

    await connection
      .collection("permissions")
      .deleteOne({ key: showKey("deleted_perm", "secret") });

    const forHolder = await getSubmission(api, holder.token, created.id);
    expect(forHolder.values.secret).toBe("[redacted]");
    const forWildcard = await getSubmission(api, wildcard.token, created.id);
    expect(forWildcard.values.secret).toBe("[redacted]");
    const forRoot = await getSubmission(api, root, created.id);
    expect(forRoot.values.secret).toBe("機密");
  });

  it("設計器預覽不套欄位級權限只限本表單:引用別張表單的受保護欄位當顯示欄,讀不出原值", async () => {
    // 來源表單:受保護欄位 secret(root 建、分派給租戶)
    await publishNewForm(
      api,
      root,
      "preview_src",
      definitionOf([
        field("title", "text"),
        field("secret", "text", { permission: { show: true, edit: false } }),
      ]),
    );
    await assignForm(api, root, "preview_src", [tenant]);
    const writer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, showKey("preview_src", "secret")],
    });
    const source = await createSubmitted(api, writer.token, "preview_src", {
      title: "來源單",
      secret: "別張表單的機密",
    });
    // 租戶設計者(沒有 secret 的 show)以來源表單為基底建客製表單,草稿放一個引用欄指向 secret
    const designer = await createOperator(api, connection, {
      orgId: tenant,
      moduleKeys: ["system", "system.forms", MODULE_KEY],
      permissionKeys: ["system.forms.*", M.view, M.create],
    });
    await ok(api, designer.token, FORK_FORM, {
      input: {
        sourceKey: "preview_src",
        sourceVersion: 1,
        key: "preview_dst",
        name: "預覽目標",
      },
    });
    await saveDefinition(
      api,
      designer.token,
      "preview_dst",
      definitionOf([
        field("title", "text"),
        field("pick", "reference", {
          source: {
            provider: "form_submission",
            formKey: "preview_src",
            labelField: "secret",
          },
        }),
      ]),
      0,
    );
    const preview = await ok<{
      previewFormVersion: { values: Record<string, unknown> };
    }>(api, designer.token, PREVIEW_VERSION, {
      input: { formKey: "preview_dst", values: { pick: source.id } },
    });
    expect(JSON.stringify(preview.previewFormVersion.values)).not.toContain(
      "別張表單的機密",
    );
    expect(preview.previewFormVersion.values.pick).toEqual({
      id: source.id,
      label: null,
    });
  });

  describe("退役權限清理(三層檢查)", () => {
    const CLEANUP = "cleanup_form";

    beforeAll(async () => {
      // v1 宣告 a;v2 換成 b(a 退役);v3 換成 c(b 退役)
      await publishNewForm(
        api,
        root,
        CLEANUP,
        definitionOf([
          field("title", "text"),
          field("a", "text", { permission: { show: true, edit: false } }),
        ]),
      );
      await assignForm(api, root, CLEANUP, [tenant]);
      await createDraft(api, wildcard.token, CLEANUP, { title: "v1 的草稿" });
      await publishDefinition(
        api,
        root,
        CLEANUP,
        definitionOf([
          field("title", "text"),
          field("b", "text", { permission: { show: true, edit: false } }),
        ]),
        null,
      );
      await createSubmitted(api, wildcard.token, CLEANUP, {
        title: "v2 的已完成",
        b: "b 的值",
      });
      await publishDefinition(
        api,
        root,
        CLEANUP,
        definitionOf([
          field("title", "text"),
          field("c", "text", { permission: { show: true, edit: false } }),
        ]),
        null,
      );
    }, HOOK_TIMEOUT_MS);

    async function retired(): Promise<RetiredItem[]> {
      const data = await ok<{
        retiredFormPermissions: { items: RetiredItem[] };
      }>(api, root, RETIRED_PERMISSIONS);
      return data.retiredFormPermissions.items.filter(
        (item) => item.formKey === CLEANUP,
      );
    }

    it("列出退役的動態權限與使用狀況;模組樹與權限矩陣不列退役的", async () => {
      const items = await retired();
      expect(
        items.map(({ fieldKey, action, usage }) => ({
          fieldKey,
          action,
          usage,
        })),
      ).toEqual([
        {
          fieldKey: "a",
          action: "show",
          usage: {
            draftCount: 1,
            draftVersions: [1],
            completedCount: 0,
            completedVersions: [],
          },
        },
        {
          fieldKey: "b",
          action: "show",
          usage: {
            draftCount: 0,
            draftVersions: [],
            completedCount: 1,
            completedVersions: [2],
          },
        },
      ]);
      expect(items[0]?.name).toBe(`表單 ${CLEANUP} / a 可見`);
      const tree = await ok<{ moduleTree: TreeNode[] }>(api, root, MODULE_TREE);
      const shopping = tree.moduleTree.find((node) => node.key === MODULE_KEY);
      const keys = shopping?.permissions.map((permission) => permission.key);
      expect(keys).toContain(showKey(CLEANUP, "c"));
      expect(keys).not.toContain(showKey(CLEANUP, "a"));
      // 權限矩陣同樣不列退役的(授了也沒有欄位用它)
      const matrix = await ok<{
        roleMatrix: { modules: MatrixNode[] };
      }>(api, root, ROLE_MATRIX, { roleId: String(plain.roleId) });
      const matrixKeys = matrix.roleMatrix.modules
        .find((node) => node.key === MODULE_KEY)
        ?.permissions.map((permission) => permission.key);
      expect(matrixKeys).toContain(showKey(CLEANUP, "c"));
      expect(matrixKeys).not.toContain(showKey(CLEANUP, "a"));
    });

    it("升級到新版的提交仍算在舊版的用量:舊修訂還以舊版定義渲染", async () => {
      const submissions = connection.collection("form_submissions");
      const original = await submissions.findOne({
        formKey: CLEANUP,
        version: 2,
      });
      expect(original).not.toBeNull();
      if (!original) {
        return;
      }
      try {
        // 模擬「舊版資料升級到新版」:提交改綁 v3,舊修訂留著 v2、多一筆 v3 的升級修訂
        const [first] = original.revisions as Record<string, unknown>[];
        await submissions.updateOne(
          { _id: original._id },
          {
            $set: {
              version: 3,
              revisions: [
                { ...first, version: 2 },
                { ...first, revision: 2, version: 3, kind: "upgrade" },
              ],
            },
          },
        );

        const items = await retired();
        const b = items.find((item) => item.fieldKey === "b");
        expect(b?.usage).toEqual({
          draftCount: 0,
          draftVersions: [],
          completedCount: 1,
          completedVersions: [2],
        });
      } finally {
        await submissions.replaceOne({ _id: original._id }, original);
      }
    });

    it("1. 草稿仍用到 → 擋下並列出筆數與版本", async () => {
      const result = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "a") },
      });
      expect(codeOf(result)).toBe("PERMISSION_NOT_DELETABLE");
      expect(extensionsOf(result)).toMatchObject({
        reasons: ["USED_BY_DRAFTS"],
        usage: { draftCount: 1, draftVersions: [1] },
      });
    });

    it("1b. 被退回的單照樣擋;已作廢(終局)的單與已完成同一層 → 確認後可刪", async () => {
      const submissions = connection.collection("form_submissions");
      const filter = { formKey: CLEANUP, version: 1 };
      await submissions.updateMany(filter, { $set: { status: "returned" } });
      const returned = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "a") },
      });
      expect(extensionsOf(returned).reasons).toEqual(["USED_BY_DRAFTS"]);
      await submissions.updateMany(filter, { $set: { status: "voided" } });
      const voided = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "a") },
      });
      expect(extensionsOf(voided)).toMatchObject({
        reasons: ["CONFIRM_REQUIRED"],
        usage: { draftCount: 0, completedCount: 1, completedVersions: [1] },
      });
      await ok(api, root, DELETE_RETIRED_PERMISSION, {
        input: {
          permissionKey: showKey(CLEANUP, "a"),
          confirmCompletedUsage: true,
        },
      });
    });

    it("2. 只剩已完成的用到 → 要確認才刪;刪權限列與全部角色綁定並寫稽核", async () => {
      const permissionId = await findPermissionIdByKey(
        connection,
        showKey(CLEANUP, "b"),
      );
      await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.view, showKey(CLEANUP, "b")],
      });
      const unconfirmed = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "b") },
      });
      expect(extensionsOf(unconfirmed)).toMatchObject({
        reasons: ["CONFIRM_REQUIRED"],
        usage: { completedCount: 1 },
      });
      const deleted = await ok<{
        deleteRetiredPermission: { success: boolean; deletedKey: string };
      }>(api, root, DELETE_RETIRED_PERMISSION, {
        input: {
          permissionKey: showKey(CLEANUP, "b"),
          confirmCompletedUsage: true,
        },
      });
      expect(deleted.deleteRetiredPermission.success).toBe(true);
      expect(
        await connection
          .collection("permissions")
          .countDocuments({ key: showKey(CLEANUP, "b") }),
      ).toBe(0);
      expect(
        await connection
          .collection("core_relationships")
          .countDocuments({ type: "role_permission", secondId: permissionId }),
      ).toBe(0);
      const audit = await connection.collection("audit_logs").findOne({
        action: "permission.delete-retired",
        "before.key": showKey(CLEANUP, "b"),
      });
      expect(audit?.before).toMatchObject({
        key: showKey(CLEANUP, "b"),
        roleCount: 1,
      });
    });

    it("3. 沒有任何提交用到 → 直接刪;還在用(未退役)或不是動態權限的不能刪", async () => {
      const current = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "c") },
      });
      expect(extensionsOf(current).reasons).toEqual(["NOT_RETIRED"]);
      const seed = await call(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: M.view },
      });
      expect(extensionsOf(seed).reasons).toEqual(["NOT_DYNAMIC"]);
      await publishDefinition(
        api,
        root,
        CLEANUP,
        definitionOf([field("title", "text")]),
        null,
      );
      await ok(api, root, DELETE_RETIRED_PERMISSION, {
        input: { permissionKey: showKey(CLEANUP, "c") },
      });
      // 租戶內的人即使有權限也不能用(根組織專屬)
      const tenantAdmin = await createOperator(api, connection, {
        orgId: tenant,
        moduleKeys: ["system", "system.module-manager"],
        permissionKeys: ["system.module-manager.*"],
      });
      const denied = await call(api, tenantAdmin.token, RETIRED_PERMISSIONS);
      expect(codeOf(denied)).toBe("FORBIDDEN");
    });

    it("依表單新增權限(`create-<formKey>`)不是欄位級權限:退役清理不列、不能刪", async () => {
      const createKey = `${MODULE_KEY}.create-${CLEANUP}`;
      const module = await connection
        .collection("modules")
        .findOne<{ _id: Types.ObjectId }>({ key: MODULE_KEY });
      expect(module).not.toBeNull();
      const permissions = connection.collection("permissions");
      // 就算(不該發生地)被標了退役,清理也不能把它當欄位級權限處理
      await permissions.insertOne({
        key: createKey,
        moduleId: module?._id,
        name: `表單 ${CLEANUP} 新增`,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "dynamic",
        retiredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      try {
        const data = await ok<{
          retiredFormPermissions: { items: RetiredItem[] };
        }>(api, root, RETIRED_PERMISSIONS);
        expect(
          data.retiredFormPermissions.items.map((item) => item.key),
        ).not.toContain(createKey);
        const result = await call(api, root, DELETE_RETIRED_PERMISSION, {
          input: { permissionKey: createKey, confirmCompletedUsage: true },
        });
        expect(extensionsOf(result).reasons).toEqual(["NOT_DYNAMIC"]);
        expect(await permissions.countDocuments({ key: createKey })).toBe(1);
      } finally {
        await permissions.deleteOne({ key: createKey });
      }
    });
  });

  describe("資料範圍:依 moduleKey 套規則;建立者一律讀得到自己的單(列表不放寬)", () => {
    let targetId: string;

    beforeAll(async () => {
      targetId = await dataScopeTargetIdOf(connection, MODULE_KEY);
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await ok(api, root, SAVE_DATA_SCOPE_RULE, {
        input: { targetId, combineOp: "OR", rules: [] },
      });
    }, HOOK_TIMEOUT_MS);

    it("規則把建立者自己的單擋在列表外時,formSubmission(id) 仍讀得到(投影照套)", async () => {
      const mine = await createSubmitted(api, plain.token, FORM, {
        title: "我自己的單",
        qty: 1,
      });
      await ok(api, root, SAVE_DATA_SCOPE_RULE, {
        input: {
          targetId,
          combineOp: "OR",
          rules: [
            {
              audience: { type: "ALL" },
              filter: {
                op: "AND",
                children: [
                  {
                    field: "orgId",
                    cond: "in",
                    value: { kind: "static", values: [String(otherOrg)] },
                  },
                ],
              },
            },
          ],
        },
      });
      const list = await ok<{
        formSubmissions: { items: SubmissionRow[]; totalCount: number };
      }>(api, plain.token, FORM_SUBMISSIONS, {
        input: { moduleKey: MODULE_KEY },
      });
      expect(list.formSubmissions.totalCount).toBe(0);
      const own = await getSubmission(api, plain.token, mine.id);
      expect(own.id).toBe(mine.id);
      expect(own.values.unit_price).toBe("[redacted]");
      // 別人的單不放寬
      const others = await call(api, plain.token, SAVE_FORM_DRAFT, {
        input: {
          id: submission.id,
          expectedEditVersion: 0,
          values: {},
        },
      });
      expect(codeOf(others)).toBe("NOT_FOUND");
      // 別人的單:列表看不到、單筆也讀不到(規則照套,不因「是建立者」以外的理由放寬)
      const othersList = await ok<{
        formSubmissions: { items: SubmissionRow[]; totalCount: number };
      }>(api, plain.token, FORM_SUBMISSIONS, {
        input: { moduleKey: MODULE_KEY, formKey: FORM },
      });
      expect(othersList.formSubmissions.items.map((item) => item.id)).toEqual(
        [],
      );
      const othersRead = await call(api, plain.token, FORM_SUBMISSION, {
        id: submission.id,
      });
      expect(codeOf(othersRead)).toBe("NOT_FOUND");
      expect(JSON.stringify(othersRead.data ?? {})).not.toContain(
        "一開始的備註",
      );
    });
  });
});
