import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types, mongo } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { dataScopeTargetIdOf } from "../../data-scope/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  assignForm,
  call,
  codeOf,
  column,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  nextRequestId,
  ok,
  publishDefinition,
  publishNewForm,
  rawSubmission,
  rootToken,
} from "../test-support/form-fixtures";
import { MAX_DOCUMENT_BYTES } from "./revision-limits";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const UPGRADE = /* GraphQL */ `
  mutation Upgrade($input: UpgradeFormSubmissionsInput!) {
    upgradeFormSubmissions(input: $input) {
      upgraded {
        fromVersion
        count
      }
      skipped {
        reason
        count
      }
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

const ATTACHMENT_URL = /* GraphQL */ `
  query AttachmentUrl($id: ID!, $fieldKey: String!, $revision: Int) {
    formSubmissionAttachmentUrl(
      id: $id
      fieldKey: $fieldKey
      revision: $revision
    ) {
      url
    }
  }
`;

const REVISIONS = /* GraphQL */ `
  query Revisions($id: ID!) {
    formSubmission(id: $id) {
      submission {
        revisions {
          revision
          kind
          upgradedBy {
            id
          }
          upgradedAt
          user {
            id
          }
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

interface UpgradeResult {
  upgraded: { fromVersion: number; count: number }[];
  skipped: { reason: string; count: number }[];
}

interface RawSubmission {
  version: number;
  editVersion: number;
  values: Record<string, unknown>;
  revisions: {
    revision: number;
    version?: number;
    values: Record<string, unknown>;
    ctx: { at: Date };
  }[];
}

const V1: FormDefinition = definitionOf([
  field("title", "text"),
  field("amount", "number"),
]);

const V2: FormDefinition = definitionOf([
  field("title", "text"),
  field("amount", "number"),
  field("added", "text"),
]);

/**
 * 舊版資料升級的邊界:守門的兩個 409、明細列、隱藏當 null、資料範圍、容量跳過、還沒補版本的舊修訂、
 * 舊修訂的附件。每個案例用自己的表單(第 1 版送出一筆,再發布第 2 版)。
 */
describe("舊版資料升級的邊界", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let staff: FormOperator;
  let formSequence = 0;

  /** 一張表單:第 1 版(`v1`)送出一筆 `values`,再發布第 2 版(`v2`)。 */
  async function prepare(
    v1: FormDefinition = V1,
    v2: FormDefinition = V2,
    values?: Record<string, unknown>,
  ): Promise<{ formKey: string; id: string }> {
    formSequence += 1;
    const formKey = `edge_${String(formSequence)}`;
    await publishNewForm(api, root, formKey, v1);
    await assignForm(api, root, formKey, [tenant]);
    const submitted = await createSubmitted(
      api,
      staff.token,
      formKey,
      values ?? { title: "出差", amount: 3 },
    );
    await publishDefinition(api, root, formKey, v2, 1);
    return { formKey, id: submitted.id };
  }

  function upgrade(
    formKey: string,
    targetVersion = 2,
    clientRequestId = nextRequestId(),
    token = staff.token,
  ) {
    return call<{ upgradeFormSubmissions: UpgradeResult }>(
      api,
      token,
      UPGRADE,
      { input: { formKey, targetVersion, fills: {}, clientRequestId } },
    );
  }

  async function raw(id: string): Promise<RawSubmission> {
    return (await rawSubmission(connection, id)) as unknown as RawSubmission;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-upgrade-edges");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "升級邊界租戶" });
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("目標版不是已發布(已退役的 v1)→ 409 VERSION_NOT_PUBLISHED", async () => {
    const { formKey } = await prepare();

    const result = await upgrade(formKey, 1);

    expect(codeOf(result)).toBe("CONFLICT");
    expect(extensionsOf(result).reason).toBe("VERSION_NOT_PUBLISHED");
  });

  it("同一個 clientRequestId 拿去升級同一張表單的另一版 → 409 CLIENT_REQUEST_REUSED", async () => {
    const { formKey } = await prepare();
    const clientRequestId = nextRequestId();
    await upgrade(formKey, 2, clientRequestId);
    await publishDefinition(api, root, formKey, V2, 2);

    const reused = await upgrade(formKey, 3, clientRequestId);

    expect(codeOf(reused)).toBe("CONFLICT");
    expect(extensionsOf(reused).reason).toBe("CLIENT_REQUEST_REUSED");
  });

  it("補值:目標版的使用者填欄位但不在補值清單內 → 忽略;不是目標版的欄位 → VALIDATION_FAILED", async () => {
    const { formKey, id } = await prepare();
    const fill = (fills: Record<string, unknown>) =>
      call(api, staff.token, UPGRADE, {
        input: {
          formKey,
          targetVersion: 2,
          fills,
          clientRequestId: nextRequestId(),
        },
      });

    const unknown = await fill({ ghost: "x" });
    const ignored = await fill({ amount: "99" });

    expect(codeOf(unknown)).toBe("VALIDATION_FAILED");
    expect(ignored.errors).toBeUndefined();
    const after = await raw(id);
    expect(after.values.amount).toBe("3");
  });

  it("補值:單選的值不在選項內 → VALIDATION_FAILED(OPTION_INVALID),什麼都不改", async () => {
    const { formKey, id } = await prepare(
      V1,
      definitionOf([
        field("title", "text"),
        field("amount", "number"),
        field("kind", "select"),
      ]),
    );

    const result = await call(api, staff.token, UPGRADE, {
      input: {
        formKey,
        targetVersion: 2,
        fills: { kind: "nope" },
        clientRequestId: nextRequestId(),
      },
    });

    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fieldErrors).toEqual([
      expect.objectContaining({ fieldKey: "kind", code: "OPTION_INVALID" }),
    ]);
    const after = await raw(id);
    expect(after.version).toBe(1);
  });

  it("明細列:子欄逐一搬(目標版沒有的子欄丟掉),rowId 不變", async () => {
    const rowId = "00000000-0000-4000-8000-000000000001";
    const items = (withNote: boolean) =>
      field("items", "array", {
        columns: [
          column("qty", "number"),
          ...(withNote ? [column("note", "text")] : []),
        ],
      });
    const { formKey, id } = await prepare(
      definitionOf([field("title", "text"), items(true)]),
      definitionOf([field("title", "text"), items(false)]),
      { title: "採買", items: [{ rowId, qty: 2, note: "舊備註" }] },
    );

    await upgrade(formKey);

    const after = await raw(id);
    expect(after.values.items).toEqual([{ rowId, qty: "2" }]);
  });

  it("隱藏當 null:目標版顯示條件不成立的欄位升級後清空", async () => {
    const { formKey, id } = await prepare(
      V1,
      definitionOf([
        field("title", "text", {
          visibleWhen: { "==": [{ var: "amount" }, 999] },
        }),
        field("amount", "number"),
      ]),
    );

    await upgrade(formKey);

    const after = await raw(id);
    expect(after.version).toBe(2);
    expect(after.values.title).toBeNull();
  });

  it("加上升級修訂後超過容量上限 → 跳過並計數(DOCUMENT_TOO_LARGE)", async () => {
    const { formKey, id } = await prepare();
    const setPadding = (padding: string) =>
      connection
        .collection("form_submissions")
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { "revisions.0.values.padding": padding } },
        );
    await setPadding("x");
    const room =
      MAX_DOCUMENT_BYTES - 40 - mongo.BSON.calculateObjectSize(await raw(id));
    await setPadding("x".repeat(room + 1));

    const result = await upgrade(formKey);

    expect(result.data?.upgradeFormSubmissions.skipped).toEqual([
      { reason: "DOCUMENT_TOO_LARGE", count: 1 },
    ]);
    const after = await raw(id);
    expect(after.version).toBe(1);
  });

  it("還沒補版本的舊修訂在升級時一併補成改綁前的版本", async () => {
    const { formKey, id } = await prepare();
    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $unset: { "revisions.0.version": "" } },
      );

    const result = await upgrade(formKey);

    expect(result.errors).toBeUndefined();
    const after = await raw(id);
    expect(after.revisions.map((entry) => entry.version)).toEqual([1, 2]);
  });

  it("舊修訂的附件:以那個修訂的版本找欄位(目標版已拿掉上傳欄)", async () => {
    const ticket = await ok<{ createUploadUrl: { objectPath: string } }>(
      api,
      staff.token,
      CREATE_UPLOAD_URL,
      {
        input: {
          purpose: "FORM_ATTACHMENT",
          contentType: "application/pdf",
          size: 1000,
        },
      },
    );
    const path = ticket.createUploadUrl.objectPath;
    const { formKey, id } = await prepare(
      definitionOf([field("title", "text"), field("file", "upload")]),
      V2,
      {
        title: "有附件",
        file: {
          path,
          name: "報價單.pdf",
          size: 1000,
          contentType: "application/pdf",
        },
      },
    );
    await upgrade(formKey);

    const url = await ok<{ formSubmissionAttachmentUrl: { url: string } }>(
      api,
      staff.token,
      ATTACHMENT_URL,
      { id, fieldKey: "file", revision: 1 },
    );

    expect(url.formSubmissionAttachmentUrl.url).toContain(path);
  });

  describe("重算用那筆資料自己的 ctx(不是升級的操作者與此刻)", () => {
    let boss: FormOperator;
    let formKey: string;
    let id: string;

    beforeAll(async () => {
      boss = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.view, M.create, M.edit],
      });
      const withNote = definitionOf([
        field("title", "text"),
        field("note", "text"),
      ]);
      ({ formKey, id } = await prepare(
        withNote,
        definitionOf([
          field("title", "text"),
          // 只有填寫者本人時顯示:用升級者的身分算會被判成隱藏而清空
          field("note", "text", {
            visibleWhen: {
              "==": [{ var: "ctx.user.id" }, String(staff.userId)],
            },
          }),
          field("who", "text", {
            valueSource: { kind: "computed", expr: { var: "ctx.user.id" } },
          }),
          field("stamp", "datetime", {
            valueSource: { kind: "computed", expr: { var: "ctx.now" } },
          }),
        ]),
        { title: "出差", note: "保留" },
      ));
      await upgrade(formKey, 2, nextRequestId(), boss.token);
    }, HOOK_TIMEOUT_MS);

    it("引用 ctx.user.id 的計算欄位 = 填寫者,不是升級者", async () => {
      const after = await raw(id);

      expect(after.values.who).toBe(String(staff.userId));
    });

    it("引用 ctx.now 的計算欄位 = 那筆最後修訂的時間", async () => {
      const after = await raw(id);

      expect(after.values.stamp).toEqual(after.revisions[0]?.ctx.at);
    });

    it("依 ctx.user.id 的顯示條件照舊成立,值不被當成隱藏清空", async () => {
      const after = await raw(id);

      expect(after.values.note).toBe("保留");
    });

    it("修訂紀錄:升級那一筆帶升級者與時間,ctx 的人仍是填寫者", async () => {
      const data = await ok<{
        formSubmission: {
          submission: {
            revisions: {
              revision: number;
              kind: string | null;
              upgradedBy: { id: string } | null;
              upgradedAt: string | null;
              user: { id: string } | null;
            }[];
          };
        };
      }>(api, staff.token, REVISIONS, { id });

      const upgraded = data.formSubmission.submission.revisions[1];
      expect(upgraded).toMatchObject({
        revision: 2,
        kind: "upgrade",
        upgradedBy: { id: String(boss.userId) },
        user: { id: String(staff.userId) },
      });
      expect(upgraded?.upgradedAt).toEqual(expect.any(String));
    });
  });

  describe("資料範圍外的筆不升級", () => {
    let targetId: string;

    beforeAll(async () => {
      targetId = await dataScopeTargetIdOf(connection, MODULE_KEY);
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await ok(api, root, SAVE_DATA_SCOPE_RULE, {
        input: { targetId, combineOp: "OR", rules: [] },
      });
    }, HOOK_TIMEOUT_MS);

    it("分店的單被資料範圍擋在外面:不在升級範圍內,仍綁舊版", async () => {
      const branch = await createOrg(connection, {
        name: "分店",
        parentId: tenant,
      });
      const clerk = await createOperator(api, connection, {
        orgId: branch,
        permissionKeys: [M.view, M.create],
      });
      formSequence += 1;
      const formKey = `edge_${String(formSequence)}`;
      await publishNewForm(api, root, formKey, V1);
      await assignForm(api, root, formKey, [tenant]);
      const outside = await createSubmitted(api, clerk.token, formKey, {
        title: "分店的單",
      });
      const inside = await createSubmitted(api, staff.token, formKey, {
        title: "本店的單",
      });
      await publishDefinition(api, root, formKey, V2, 1);
      await ok(api, root, SAVE_DATA_SCOPE_RULE, {
        input: {
          targetId,
          combineOp: "OR",
          rules: [
            {
              audience: { mode: "all" },
              filter: {
                op: "AND",
                children: [
                  {
                    field: "orgId",
                    cond: "in",
                    value: { kind: "static", values: [String(tenant)] },
                  },
                ],
              },
            },
          ],
        },
      });

      const result = await upgrade(formKey);

      expect(result.data?.upgradeFormSubmissions.upgraded).toEqual([
        { fromVersion: 1, count: 1 },
      ]);
      const outsideAfter = await raw(outside.id);
      const insideAfter = await raw(inside.id);
      expect([outsideAfter.version, insideAfter.version]).toEqual([1, 2]);
    });
  });
});
