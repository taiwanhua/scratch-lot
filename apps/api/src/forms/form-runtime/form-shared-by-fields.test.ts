import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  DELETE_SUBMISSION,
  FORM_SUBMISSION,
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  SAVE_FORM_DRAFT,
  type SubmissionRow,
  UPDATE_FORM,
  UPDATE_SUBMISSION,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  getSubmission,
  ok,
  publishNewForm,
  rawSubmission,
  rootToken,
  submitDraft,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM_KEY = "shared_by_branch";
const orgField = (key: string) =>
  field(key, "reference", { source: { provider: "org", labelField: "name" } });

const DEFINITION = definitionOf([
  field("title", "text"),
  orgField("branch"),
  orgField("to_branch"),
]);

const FORM_SHARED_BY = /* GraphQL */ `
  query FormSharedBy($key: ID!) {
    form(key: $key) {
      form {
        sharedByFieldKeys
      }
    }
  }
`;

const ABILITIES = /* GraphQL */ `
  query SharedAbilities($id: ID!) {
    formSubmission(id: $id) {
      submission {
        id
        abilities {
          canEdit
          canDelete
          canCopy
        }
      }
    }
  }
`;

interface ListData {
  formSubmissions: { items: { id: string }[]; totalCount: number };
}

/**
 * 依欄位共用(表單設定 `sharedByFieldKeys` → 提交的 `sharedOrgIds`,ADR-0014):總部建的單,
 * 欄位指到的分店看得到(列表 / 單筆)、改不了;別的分店與別的租戶看不到;改了欄位,看得到的人跟著變。
 * 組織樹:根 → 租戶甲(含下層)→ 中山店 / 信義店;根 → 租戶乙 → 乙分店。
 */
describe("依欄位共用(表單設定 sharedByFieldKeys)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let otherBranch: Types.ObjectId;
  let hq: FormOperator;
  let zhongshanManager: FormOperator;
  let xinyiManager: FormOperator;
  let otherTenantUser: FormOperator;

  const ALL = [M.view, M.create, M.edit, M.delete];

  async function listIds(operator: FormOperator): Promise<string[]> {
    const data = await ok<ListData>(api, operator.token, FORM_SUBMISSIONS, {
      input: { moduleKey: MODULE_KEY, formKey: FORM_KEY },
    });
    return data.formSubmissions.items.map((item) => item.id);
  }

  async function sharedOrgIdsOf(id: string): Promise<string[]> {
    const raw = await rawSubmission(connection, id);
    return ((raw?.sharedOrgIds ?? []) as Types.ObjectId[]).map(String);
  }

  function submit(
    values: Record<string, unknown>,
    operator: FormOperator = hq,
  ): Promise<SubmissionRow> {
    return createSubmitted(api, operator.token, FORM_KEY, {
      title: "進貨",
      ...values,
    });
  }

  async function setSharedBy(keys: string[] | null): Promise<void> {
    await ok(api, root, UPDATE_FORM, {
      input: { key: FORM_KEY, sharedByFieldKeys: keys },
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_shared_by_fields");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "依欄位共用租戶",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    const otherTenant = await createOrg(connection, { name: "別的租戶" });
    otherBranch = await createOrg(connection, {
      name: "乙分店",
      parentId: otherTenant,
    });
    await publishNewForm(api, root, FORM_KEY, DEFINITION, "進貨單");
    await assignForm(api, root, FORM_KEY, [tenant, otherTenant]);
    hq = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: ALL,
    });
    zhongshanManager = await createOperator(api, connection, {
      orgId: zhongshan,
      ownerOrgId: tenant,
      permissionKeys: ALL,
    });
    xinyiManager = await createOperator(api, connection, {
      orgId: xinyi,
      ownerOrgId: tenant,
      permissionKeys: ALL,
    });
    otherTenantUser = await createOperator(api, connection, {
      orgId: otherBranch,
      ownerOrgId: otherTenant,
      permissionKeys: ALL,
    });
    await setSharedBy(["branch", "to_branch"]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("表單設定:回在表單上;指到不存在或不是組織引用的欄位 → VALIDATION_FAILED", async () => {
    const data = await ok<{ form: { form: { sharedByFieldKeys: string[] } } }>(
      api,
      root,
      FORM_SHARED_BY,
      { key: FORM_KEY },
    );
    expect(data.form.form.sharedByFieldKeys).toEqual(["branch", "to_branch"]);
    for (const keys of [["title"], ["missing"], ["branch", "branch"]]) {
      const result = await call(api, root, UPDATE_FORM, {
        input: { key: FORM_KEY, sharedByFieldKeys: keys },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fields).toEqual(["sharedByFieldKeys"]);
    }
  });

  it("總部建單、進貨分店 = 中山店:中山店長列表與單筆看得到、不能改不能刪;信義店長與別的租戶看不到", async () => {
    const submitted = await submit({ branch: String(zhongshan) });
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([String(zhongshan)]);

    expect(await listIds(zhongshanManager)).toContain(submitted.id);
    const viewed = await ok<{
      formSubmission: {
        submission: {
          abilities: { canEdit: boolean; canDelete: boolean; canCopy: boolean };
        };
      };
    }>(api, zhongshanManager.token, ABILITIES, { id: submitted.id });
    expect(viewed.formSubmission.submission.abilities).toEqual({
      canEdit: false,
      canDelete: false,
      canCopy: false,
    });
    const update = await call(api, zhongshanManager.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: { title: "分店改的" },
      },
    });
    expect(codeOf(update)).toBe("FORBIDDEN");
    expect(extensionsOf(update).reason).toBe("SHARED_READ_ONLY");
    const removed = await call(api, zhongshanManager.token, DELETE_SUBMISSION, {
      input: { id: submitted.id },
    });
    expect(codeOf(removed)).toBe("FORBIDDEN");
    const kept = await rawSubmission(connection, submitted.id);
    expect(kept?.deletedAt).toBeNull();

    expect(await listIds(xinyiManager)).not.toContain(submitted.id);
    expect(
      codeOf(
        await call(api, xinyiManager.token, FORM_SUBMISSION, {
          id: submitted.id,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await listIds(otherTenantUser)).not.toContain(submitted.id);
    expect(
      codeOf(
        await call(api, otherTenantUser.token, FORM_SUBMISSION, {
          id: submitted.id,
        }),
      ),
    ).toBe("NOT_FOUND");
    // 總部(歸屬)照常改得動
    const own = await getSubmission(api, hq.token, submitted.id);
    expect(own.abilities.canEdit).toBe(true);
  });

  it("兩個欄位(出貨店、收貨店):兩邊店都看得到", async () => {
    const submitted = await submit({
      branch: String(zhongshan),
      to_branch: String(xinyi),
    });
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([
      String(zhongshan),
      String(xinyi),
    ]);
    expect(await listIds(zhongshanManager)).toContain(submitted.id);
    expect(await listIds(xinyiManager)).toContain(submitted.id);
  });

  it("改了分店欄,看得到的人跟著變(已完成後修改)", async () => {
    const submitted = await submit({ branch: String(zhongshan) });
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, hq.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: { title: "改到信義", branch: String(xinyi) },
      },
    });
    expect(updated.updateFormSubmission.submission.revision).toBe(2);
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([String(xinyi)]);
    expect(await listIds(xinyiManager)).toContain(submitted.id);
    expect(await listIds(zhongshanManager)).not.toContain(submitted.id);
  });

  it("草稿不共用(存草稿也是空);送出後才給欄位指到的分店看", async () => {
    const draft = await createDraft(api, hq.token, FORM_KEY, {
      title: "草稿",
      branch: String(zhongshan),
    });
    expect(await sharedOrgIdsOf(draft.id)).toEqual([]);
    const saved = await ok<{ saveFormDraft: { submission: SubmissionRow } }>(
      api,
      hq.token,
      SAVE_FORM_DRAFT,
      {
        input: {
          id: draft.id,
          expectedEditVersion: draft.editVersion,
          values: { branch: String(xinyi) },
        },
      },
    );
    expect(await sharedOrgIdsOf(draft.id)).toEqual([]);
    expect(await listIds(xinyiManager)).not.toContain(draft.id);
    expect(
      codeOf(
        await call(api, xinyiManager.token, FORM_SUBMISSION, { id: draft.id }),
      ),
    ).toBe("NOT_FOUND");
    await submitDraft(api, hq.token, saved.saveFormDraft.submission);
    expect(await sharedOrgIdsOf(draft.id)).toEqual([String(xinyi)]);
    expect(await listIds(xinyiManager)).toContain(draft.id);
  });

  it("清掉表單設定:之後的寫入不再共用", async () => {
    await setSharedBy(null);
    try {
      const submitted = await submit({ branch: String(zhongshan) });
      expect(await sharedOrgIdsOf(submitted.id)).toEqual([]);
      expect(await listIds(zhongshanManager)).not.toContain(submitted.id);
    } finally {
      await setSharedBy(["branch", "to_branch"]);
    }
  });
});
