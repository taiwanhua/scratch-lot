import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { COPY, VOID } from "../../workflows/test-support/workflow-fixtures";
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
  nextRequestId,
  ok,
  publishDefinition,
  publishNewForm,
  rawSubmission,
  rootToken,
  submitDraft,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM_KEY = "shared_by_org";
const orgField = (key: string) =>
  field(key, "reference", { source: { provider: "org", labelField: "name" } });

const DEFINITION = definitionOf([
  field("title", "text"),
  orgField("receiver_org"),
  orgField("supplier_org"),
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

const UPGRADE = /* GraphQL */ `
  mutation SharedUpgrade($input: UpgradeFormSubmissionsInput!) {
    upgradeFormSubmissions(input: $input) {
      upgraded {
        count
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
 * 欄位指到的組織看得到(列表 / 單筆)、改不了;別的組織與別的租戶看不到;改了欄位,看得到的人跟著變。
 * 組織樹:根 → 租戶甲(含下層)→ 甲店 / 乙店;根 → 租戶乙 → 別租戶的店。
 */
describe("依欄位共用(表單設定 sharedByFieldKeys)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let otherBranch: Types.ObjectId;
  let hq: FormOperator;
  let storeAManager: FormOperator;
  let storeBManager: FormOperator;
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
      title: "購物",
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
    storeA = await createOrg(connection, {
      name: "甲店",
      parentId: tenant,
    });
    storeB = await createOrg(connection, { name: "乙店", parentId: tenant });
    const otherTenant = await createOrg(connection, { name: "別的租戶" });
    otherBranch = await createOrg(connection, {
      name: "別租戶的店",
      parentId: otherTenant,
    });
    await publishNewForm(api, root, FORM_KEY, DEFINITION, "購物單");
    await assignForm(api, root, FORM_KEY, [tenant, otherTenant]);
    hq = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: ALL,
    });
    storeAManager = await createOperator(api, connection, {
      orgId: storeA,
      ownerOrgId: tenant,
      permissionKeys: ALL,
    });
    storeBManager = await createOperator(api, connection, {
      orgId: storeB,
      ownerOrgId: tenant,
      permissionKeys: ALL,
    });
    otherTenantUser = await createOperator(api, connection, {
      orgId: otherBranch,
      ownerOrgId: otherTenant,
      permissionKeys: ALL,
    });
    await setSharedBy(["receiver_org", "supplier_org"]);
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
    expect(data.form.form.sharedByFieldKeys).toEqual([
      "receiver_org",
      "supplier_org",
    ]);
    for (const keys of [
      ["title"],
      ["missing"],
      ["receiver_org", "receiver_org"],
    ]) {
      const result = await call(api, root, UPDATE_FORM, {
        input: { key: FORM_KEY, sharedByFieldKeys: keys },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fields).toEqual(["sharedByFieldKeys"]);
    }
  });

  it("最上層組織建單、收貨組織 = 甲店:甲店的人列表與單筆看得到、不能改不能刪;乙店與別的租戶看不到", async () => {
    const submitted = await submit({ receiver_org: String(storeA) });
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([String(storeA)]);

    expect(await listIds(storeAManager)).toContain(submitted.id);
    const viewed = await ok<{
      formSubmission: {
        submission: {
          abilities: { canEdit: boolean; canDelete: boolean; canCopy: boolean };
        };
      };
    }>(api, storeAManager.token, ABILITIES, { id: submitted.id });
    expect(viewed.formSubmission.submission.abilities).toEqual({
      canEdit: false,
      canDelete: false,
      canCopy: false,
    });
    const update = await call(api, storeAManager.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: { title: "甲店改的" },
      },
    });
    expect(codeOf(update)).toBe("FORBIDDEN");
    expect(extensionsOf(update).reason).toBe("SHARED_READ_ONLY");
    const removed = await call(api, storeAManager.token, DELETE_SUBMISSION, {
      input: { id: submitted.id },
    });
    expect(codeOf(removed)).toBe("FORBIDDEN");
    const kept = await rawSubmission(connection, submitted.id);
    expect(kept?.deletedAt).toBeNull();

    expect(await listIds(storeBManager)).not.toContain(submitted.id);
    expect(
      codeOf(
        await call(api, storeBManager.token, FORM_SUBMISSION, {
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

  it("兩個組織欄(收貨組織、供應組織):兩邊都看得到", async () => {
    const submitted = await submit({
      receiver_org: String(storeA),
      supplier_org: String(storeB),
    });
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([
      String(storeA),
      String(storeB),
    ]);
    expect(await listIds(storeAManager)).toContain(submitted.id);
    expect(await listIds(storeBManager)).toContain(submitted.id);
  });

  it("改了組織欄,看得到的人跟著變(已完成後修改)", async () => {
    const submitted = await submit({ receiver_org: String(storeA) });
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, hq.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: { title: "改到乙店", receiver_org: String(storeB) },
      },
    });
    expect(updated.updateFormSubmission.submission.revision).toBe(2);
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([String(storeB)]);
    expect(await listIds(storeBManager)).toContain(submitted.id);
    expect(await listIds(storeAManager)).not.toContain(submitted.id);
  });

  it("草稿不共用(存草稿也是空);送出後才給欄位指到的組織看", async () => {
    const draft = await createDraft(api, hq.token, FORM_KEY, {
      title: "草稿",
      receiver_org: String(storeA),
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
          values: { receiver_org: String(storeB) },
        },
      },
    );
    expect(await sharedOrgIdsOf(draft.id)).toEqual([]);
    expect(await listIds(storeBManager)).not.toContain(draft.id);
    expect(
      codeOf(
        await call(api, storeBManager.token, FORM_SUBMISSION, { id: draft.id }),
      ),
    ).toBe("NOT_FOUND");
    await submitDraft(api, hq.token, saved.saveFormDraft.submission);
    expect(await sharedOrgIdsOf(draft.id)).toEqual([String(storeB)]);
    expect(await listIds(storeBManager)).toContain(draft.id);
  });

  it("清掉表單設定:之後的寫入不再共用", async () => {
    await setSharedBy(null);
    try {
      const submitted = await submit({ receiver_org: String(storeA) });
      expect(await sharedOrgIdsOf(submitted.id)).toEqual([]);
      expect(await listIds(storeAManager)).not.toContain(submitted.id);
    } finally {
      await setSharedBy(["receiver_org", "supplier_org"]);
    }
  });
  it("作廢 / 複製為新單:共用進來的人實際呼叫 → FORBIDDEN(SHARED_READ_ONLY)", async () => {
    const approved = await submit({ receiver_org: String(storeA) });
    // 模擬走過流程核准(作廢只收綁流程的已完成)
    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: new Types.ObjectId(approved.id) },
        { $set: { currentInstanceId: new Types.ObjectId() } },
      );
    const voided = await call(api, storeAManager.token, VOID, {
      input: {
        id: approved.id,
        expectedEditVersion: approved.editVersion,
        reasonNote: "甲店作廢",
      },
    });
    expect(codeOf(voided)).toBe("FORBIDDEN");
    expect(extensionsOf(voided).reason).toBe("SHARED_READ_ONLY");

    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: new Types.ObjectId(approved.id) },
        { $set: { status: "voided" } },
      );
    const copied = await call(api, storeAManager.token, COPY, {
      input: { id: approved.id, clientRequestId: nextRequestId() },
    });
    expect(codeOf(copied)).toBe("FORBIDDEN");
    expect(extensionsOf(copied).reason).toBe("SHARED_READ_ONLY");
  });

  it("組織欄指到別租戶的組織:別租戶的人一樣看不到(共用分支釘 tenantId)", async () => {
    const submitted = await submit({ receiver_org: String(storeA) });
    // 資料損毀 / 舊資料:sharedOrgIds 直接指到別租戶的店
    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: new Types.ObjectId(submitted.id) },
        { $set: { sharedOrgIds: [otherBranch] } },
      );
    expect(await listIds(otherTenantUser)).not.toContain(submitted.id);
    expect(
      codeOf(
        await call(api, otherTenantUser.token, FORM_SUBMISSION, {
          id: submitted.id,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("舊版資料升級到新版:sharedOrgIds 跟著升級後的值重算", async () => {
    const submitted = await submit({ receiver_org: String(storeA) });
    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: new Types.ObjectId(submitted.id) },
        { $set: { sharedOrgIds: [] } },
      );
    await publishDefinition(api, root, FORM_KEY, DEFINITION, 1);
    const upgraded = await ok<{
      upgradeFormSubmissions: { upgraded: { count: number }[] };
    }>(api, hq.token, UPGRADE, {
      input: {
        formKey: FORM_KEY,
        targetVersion: 2,
        fills: {},
        clientRequestId: nextRequestId(),
      },
    });
    expect(
      upgraded.upgradeFormSubmissions.upgraded.reduce(
        (sum, group) => sum + group.count,
        0,
      ),
    ).toBeGreaterThan(0);
    expect(await sharedOrgIdsOf(submitted.id)).toEqual([String(storeA)]);
  });
});
