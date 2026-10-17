import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { type FieldDef, arrayRowChanges } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { LookupProvidersService } from "../lookup-providers";
import {
  FORM_LOOKUP,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  SUBMIT,
  UPDATE_SUBMISSION,
  VALIDATE_VERSION,
  assignForm,
  call,
  codeOf,
  column,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  getSubmission,
  ok,
  publishNewForm,
  rootToken,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

type Row = Record<string, unknown> & { rowId: string };

/** 200 列引用的不同使用者數(每列輪流引用,同一子欄的 id 會重複)。 */
const DISTINCT_USERS = 90;

function rowsOf(values: Record<string, unknown>): Row[] {
  return (values.lines ?? []) as Row[];
}

/** 清單的第 `index` 個(超過長度就從頭輪)。 */
function cycleAt<T>(list: readonly T[], index: number): T {
  const item = list[index % list.length];
  if (item === undefined) {
    throw new Error("empty list");
  }
  return item;
}

/**
 * 明細子欄支援引用(《底座規格》3.2 B2b):存 `{ id, label }` 快照;送出重驗每一列並重取 label,
 * **同一子欄的 id 合併成一次查詢**;讀不到 → `VALIDATION_FAILED`(錯誤定位到 `rowId` + 子欄);
 * `displayValues` 以 `<明細 key>.<子欄 key>` 回現名;修訂差異比 id;權限繼承整個明細欄。
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("明細引用子欄:快照 / 一次查詢 / 讀不到擋下 / 現名 / 差異 / 權限", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let staff: FormOperator;
  let users: Types.ObjectId[];
  let outsider: Types.ObjectId;

  const FORM = "transfers";

  const who = column("who", "reference", {
    source: { provider: "user", labelField: "name" },
  });
  const lines = field("lines", "array", {
    columns: [
      who,
      column("receiver", "reference", {
        source: { provider: "user", labelField: "name" },
      }),
      column("qty", "number"),
    ],
    rules: { maxRows: 200 },
  });
  const fields: FieldDef[] = [
    field("title", "text"),
    lines,
    field("secret_lines", "array", {
      columns: [
        column("who", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ],
      permission: { show: true, edit: true },
    }),
  ];

  /** 直接寫入 n 個同租戶的使用者(不走 bcrypt,夾具只要讀得到)。 */
  async function insertUsers(
    orgId: Types.ObjectId,
    prefix: string,
    count: number,
  ): Promise<Types.ObjectId[]> {
    const now = new Date();
    const ids = Array.from({ length: count }, () => new Types.ObjectId());
    await connection.collection("users").insertMany(
      ids.map((_id, index) => ({
        _id,
        name: `${prefix}${String(index)}`,
        account: `${prefix}${String(index)}`,
        email: `${prefix}${String(index)}@example.com`,
        passwordHash: "unused",
        enabled: true,
        settings: {},
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      })),
    );
    await connection.collection("core_relationships").insertMany(
      ids.map((secondId) => ({
        type: "org_user",
        firstId: orgId,
        secondId,
        thirdId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      })),
    );
    return ids;
  }

  function lineOf(user: Types.ObjectId, rowId = randomUUID()): Row {
    return { rowId, who: { id: String(user), label: "前端給的" }, qty: 1 };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-array-reference");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "引用子欄租戶" });
    const otherTenant = await createOrg(connection, { name: "別的租戶" });
    // 租戶成員數壓在一批游標(101)以內:超過時交易內的 getMore 會撞上既有的 driver 問題(見回報),與本票無關
    users = await insertUsers(tenant, "staff_", DISTINCT_USERS);
    [outsider] = (await insertUsers(otherTenant, "outsider_", 1)) as [
      Types.ObjectId,
    ];
    await publishNewForm(api, root, FORM, definitionOf(fields));
    await assignForm(api, root, FORM, [tenant]);
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("200 列引用送出:每子欄只查一次(id 去重合併),label 重取寫快照", async () => {
    const lookups = api.app.get(LookupProvidersService);
    const spy = jest.spyOn(lookups, "findByValues");
    try {
      const draft = await createDraft(api, staff.token, FORM, {
        title: "大量調貨",
        lines: Array.from({ length: 200 }, (_, index) => ({
          ...lineOf(cycleAt(users, index)),
          receiver: String(cycleAt(users, index + 1)),
        })),
      });
      spy.mockClear();
      const submitted = await ok<{
        submitFormSubmission: {
          submission: { values: Record<string, unknown> };
        };
      }>(api, staff.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      // 寫快照的查詢(`publicOnly`);回應的現名解析是另一條(讀者權限),不算在內
      const snapshotCalls = spy.mock.calls.filter(
        (args) => args[1].provider === "user" && args[5]?.publicOnly === true,
      );
      // 兩個引用子欄 → 兩次查詢,每次帶該子欄去重後的全部 id
      expect(snapshotCalls).toHaveLength(2);
      for (const call of snapshotCalls) {
        expect(call[3]).toHaveLength(DISTINCT_USERS);
      }
      const rows = rowsOf(submitted.submitFormSubmission.submission.values);
      expect(rows).toHaveLength(200);
      expect(rows[0]?.who).toEqual({ id: String(users[0]), label: "staff_0" });
      expect(rows[199]?.who).toEqual({
        id: String(cycleAt(users, 199)),
        label: `staff_${String(199 % DISTINCT_USERS)}`,
      });
      expect(rows[199]?.receiver).toEqual({
        id: String(cycleAt(users, 200)),
        label: `staff_${String(200 % DISTINCT_USERS)}`,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("引用的資料被刪 / 看不到(別租戶) → VALIDATION_FAILED,fieldErrors 指到列", async () => {
    const [kept, removed] = (await insertUsers(tenant, "temp_", 2)) as [
      Types.ObjectId,
      Types.ObjectId,
    ];
    const goodRow = lineOf(kept);
    const deletedRow = lineOf(removed);
    const foreignRow = lineOf(outsider);
    const draft = await createDraft(api, staff.token, FORM, {
      title: "有讀不到的",
      lines: [goodRow, deletedRow, foreignRow],
    });
    await connection
      .collection("users")
      .updateOne({ _id: removed }, { $set: { deletedAt: new Date() } });
    const result = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    const errors = extensionsOf(result).fieldErrors as {
      fieldKey: string;
      rowId?: string;
      columnKey?: string;
      code: string;
    }[];
    expect(
      errors
        .filter((issue) => issue.code === "SOURCE_UNAVAILABLE")
        .map((issue) => [issue.fieldKey, issue.rowId, issue.columnKey]),
    ).toEqual([
      ["lines", deletedRow.rowId, "who"],
      ["lines", foreignRow.rowId, "who"],
    ]);
  });

  it("displayValues 以 `lines.who` 回現名;來源已刪 → 快照 + available false", async () => {
    const [renamed, gone] = (await insertUsers(tenant, "display_", 2)) as [
      Types.ObjectId,
      Types.ObjectId,
    ];
    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "現名",
      lines: [lineOf(renamed), lineOf(gone), lineOf(renamed)],
    });
    await connection
      .collection("users")
      .updateOne({ _id: renamed }, { $set: { name: "改名後" } });
    await connection
      .collection("users")
      .updateOne({ _id: gone }, { $set: { deletedAt: new Date() } });
    const view = await getSubmission(api, staff.token, submitted.id);
    expect(
      view.displayValues.find((entry) => entry.fieldKey === "lines.who"),
    ).toEqual({
      fieldKey: "lines.who",
      items: [
        { value: String(renamed), label: "改名後", available: true },
        { value: String(gone), label: "display_1", available: false },
      ],
    });
    // 存的快照不變
    expect(rowsOf(view.values)[0]?.who).toEqual({
      id: String(renamed),
      label: "display_0",
    });
  });

  it("修訂差異只在 id 變時列出(label 快照不同不算)", async () => {
    const [first, second, replacement] = (await insertUsers(
      tenant,
      "diff_",
      3,
    )) as [Types.ObjectId, Types.ObjectId, Types.ObjectId];
    const A = randomUUID();
    const B = randomUUID();
    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "修訂",
      lines: [lineOf(first, A), lineOf(second, B)],
    });
    await ok(api, staff.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: {
          ...submitted.values,
          lines: [
            {
              rowId: A,
              who: { id: String(first), label: "label 亂給" },
              qty: 1,
            },
            lineOf(replacement, B),
          ],
        },
      },
    });
    const before = await getSubmission(api, staff.token, submitted.id, 1);
    const after = await getSubmission(api, staff.token, submitted.id, 2);
    // 同 id 保留上一版的快照
    expect(rowsOf(after.values)[0]?.who).toEqual({
      id: String(first),
      label: "diff_0",
    });
    expect(
      arrayRowChanges(lines, before.values.lines, after.values.lines).map(
        (change) => [change.rowId, change.kind, change.changedColumns],
      ),
    ).toEqual([[B, "kept", ["who"]]]);
  });

  it("formLookup 以 `lines.who` 查候選;權限繼承整個明細欄(受保護明細沒有 show → 403)", async () => {
    const result = await ok<{
      formLookup: { items: { id: string; label: string | null }[] };
    }>(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey: "lines.who" },
        keyword: "staff_19",
        page: 1,
        pageSize: 50,
      },
    });
    expect(result.formLookup.items.map((item) => item.label)).toContain(
      "staff_19",
    );
    const guarded = await call(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey: "secret_lines.who" },
      },
    });
    expect(codeOf(guarded)).toBe("FORBIDDEN");
    const notReference = await call(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey: "lines.qty" },
      },
    });
    expect(codeOf(notReference)).toBe("VALIDATION_FAILED");
  });

  it("檢查器:引用子欄的來源對照 api 的登錄表(未登錄的來源、表單提交來源沒有的欄位,定位到子欄)", async () => {
    const report = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: FORM,
        ...definitionOf([
          field("title", "text"),
          field("lines", "array", {
            columns: [
              column("vendor", "reference", {
                source: { provider: "nowhere", labelField: "name" },
              }),
              column("order", "reference", {
                source: {
                  provider: "form_submission",
                  formKey: FORM,
                  labelField: "missing",
                },
              }),
            ],
          }),
        ]),
      },
    });
    expect(
      report.validateFormVersion.errors.map((issue) => [
        issue.code,
        issue.location.fieldKey,
        issue.location.columnKey,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["LOOKUP_UNKNOWN_PROVIDER", "lines", "vendor"],
        ["LOOKUP_UNKNOWN_FIELD", "lines", "order"],
      ]),
    );
  });
});
