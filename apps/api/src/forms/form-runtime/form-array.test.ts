import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import { type FieldDef, arrayRowChanges } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_FORM_DRAFT,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  SUBMIT,
  type SubmissionRow,
  UPDATE_SUBMISSION,
  assignForm,
  call,
  codeOf,
  column,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  editKey,
  extensionsOf,
  field,
  getSubmission,
  nextRequestId,
  ok,
  publishNewForm,
  rawSubmission,
  rootToken,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

type Row = Record<string, unknown> & { rowId: string };

function itemRow(rowId: string, cells: Record<string, unknown>): Row {
  return { rowId, name: "品項", ...cells };
}

/**
 * 明細列(見 `docs/modules/forms.md`「明細列」):後端依完整依賴圖算列內公式與彙總、整欄套「不能填的
 * 四種原因」(隱藏清空、沒有 edit 保留)、整欄保護傳遞、錯誤定位 `明細 key + rowId + 子欄 key`、
 * 修訂以 `rowId` 對列。複製為新單換 `rowId` 在申請中心的複製測試(要走流程作廢)。
 */
describe("明細列(array):計算 / 守門 / 保護傳遞 / 錯誤定位 / 修訂差異", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let author: FormOperator;
  let plain: FormOperator;

  const FORM = "orders";

  const items = field("items", "array", {
    columns: [
      column("name", "text", { rules: { required: true } }),
      column("qty", "number"),
      column("price", "number", { precision: 2 }),
      column("due", "date"),
      column("subtotal", "number", {
        valueSource: {
          kind: "computed",
          expr: { "*": [{ var: "row.qty" }, { var: "row.price" }] },
        },
      }),
    ],
    visibleWhen: { "==": [{ var: "show_items" }, true] },
  });

  const fields: FieldDef[] = [
    field("title", "text"),
    field("show_items", "boolean"),
    field("unit_cost", "number", {
      precision: 2,
      permission: { show: true, edit: false },
    }),
    items,
    field("total", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["items", "subtotal"] } },
    }),
    field("line_count", "number", {
      valueSource: { kind: "computed", expr: { countOf: ["items"] } },
    }),
    field("costs", "array", {
      columns: [
        column("qty", "number"),
        column("cost", "number", {
          precision: 2,
          valueSource: {
            kind: "computed",
            expr: { "*": [{ var: "row.qty" }, { var: "unit_cost" }] },
          },
        }),
      ],
    }),
    field("cost_total", "number", {
      precision: 2,
      valueSource: { kind: "computed", expr: { sumOf: ["costs", "cost"] } },
    }),
    field("checked", "array", {
      columns: [column("item", "text")],
      permission: { show: false, edit: true },
      rules: { required: true },
    }),
    field("multiplier", "number"),
    field("packed", "array", {
      columns: [
        column("qty", "number"),
        column("scaled", "number", {
          valueSource: {
            kind: "computed",
            expr: { "*": [{ var: "row.qty" }, { var: "multiplier" }] },
          },
        }),
      ],
      permission: { show: false, edit: true },
    }),
  ];

  const A = randomUUID();
  const B = randomUUID();
  let submission: SubmissionRow;

  function baseValues(overrides: Record<string, unknown> = {}) {
    return {
      title: "訂單",
      show_items: true,
      unit_cost: "3",
      items: [
        itemRow(A, {
          name: "蘋果",
          qty: 2,
          price: "10.5",
          due: "2026-09-26T00:00:00+08:00",
          subtotal: "999",
        }),
        itemRow(B, { name: "香蕉", qty: 3, price: "1.2" }),
      ],
      costs: [{ rowId: randomUUID(), qty: 2 }],
      checked: [
        { rowId: randomUUID(), item: "已確認" },
        { rowId: randomUUID(), item: "已覆核" },
      ],
      multiplier: 2,
      packed: [{ rowId: randomUUID(), qty: 3 }],
      ...overrides,
    };
  }

  function rowsOf(row: SubmissionRow, key: string): Row[] {
    return (row.values[key] ?? []) as Row[];
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-array");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "明細租戶" });
    await publishNewForm(api, root, FORM, definitionOf(fields));
    await assignForm(api, root, FORM, [tenant]);
    const base = [M.view, M.create, M.edit];
    author = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [
        ...base,
        showKey(FORM, "unit_cost"),
        editKey(FORM, "checked"),
        editKey(FORM, "packed"),
      ],
    });
    plain = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: base,
    });
    submission = await createSubmitted(api, author.token, FORM, baseValues());
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("列內公式由後端算,送來的小計忽略", () => {
    expect(rowsOf(submission, "items").map((row) => row.subtotal)).toEqual([
      "21",
      "4",
    ]);
  });

  it("彙總:總額 = 各列取位後的小計相加", () => {
    // 2 × 10.5 = 21、3 × 1.2 = 3.6 → 4;不取位相加是 24.6 → 25
    expect(submission.values.total).toBe("25");
  });

  it("countOf = 列數", () => {
    expect(submission.values.line_count).toBe("2");
  });

  it("rowId 原樣保留、日期子欄存 Mongo Date", async () => {
    const raw = await rawSubmission(connection, submission.id);
    const [first] = (raw?.values as { items: Row[] }).items;
    expect(first?.rowId).toBe(A);
    expect(first?.due).toBeInstanceOf(Date);
  });

  it("rowId 重複 → VALIDATION_FAILED(ARRAY_ROW_ID_INVALID)", async () => {
    const result = await call(api, author.token, CREATE_FORM_DRAFT, {
      input: {
        formKey: FORM,
        clientRequestId: nextRequestId(),
        values: baseValues({
          items: [itemRow(A, { qty: 1 }), itemRow(A, { qty: 2 })],
        }),
      },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fieldErrors).toEqual([
      expect.objectContaining({
        fieldKey: "items",
        code: "ARRAY_ROW_ID_INVALID",
      }),
    ]);
  });

  it("每一格的錯誤定位到明細 key + rowId + 子欄 key", async () => {
    const draft = await createDraft(
      api,
      author.token,
      FORM,
      baseValues({ items: [itemRow(A, { name: null, qty: 1 })] }),
    );
    const result = await call(api, author.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(extensionsOf(result).fieldErrors).toEqual([
      expect.objectContaining({
        fieldKey: "items",
        rowId: A,
        columnKey: "name",
        code: "REQUIRED",
      }),
    ]);
  });

  it("隱藏的明細整欄存 null", async () => {
    const hidden = await createSubmitted(
      api,
      author.token,
      FORM,
      baseValues({ show_items: false }),
    );
    expect(hidden.values.items).toBeNull();
  });

  it("隱藏的明細彙總視為空:加總 0、列數 0", async () => {
    const hidden = await createSubmitted(
      api,
      author.token,
      FORM,
      baseValues({ show_items: false }),
    );
    expect([hidden.values.total, hidden.values.line_count]).toEqual(["0", "0"]);
  });

  it("整欄保護傳遞:子欄引用受保護欄位 → 沒有 show 的人整欄遮蔽", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    expect(view.values.costs).toBe("[redacted]");
  });

  it("彙總受保護明細的計算欄位同樣受保護", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    expect(view.values.cost_total).toBe("[redacted]");
  });

  it("有 show 的人讀得到受保護明細與它的彙總", async () => {
    const view = await getSubmission(api, author.token, submission.id);
    expect(view.values.cost_total).toBe("6.00");
  });

  it("沒有 edit 的人送不同的列集合 → 403", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    const result = await call(api, plain.token, UPDATE_SUBMISSION, {
      input: {
        id: view.id,
        expectedEditVersion: view.editVersion,
        expectedRevision: view.revision,
        values: {
          ...view.values,
          checked: [
            ...rowsOf(view, "checked"),
            { rowId: randomUUID(), item: "我加的" },
          ],
        },
      },
    });
    expect(extensionsOf(result)).toMatchObject({
      code: "FORBIDDEN",
      reason: "FIELD_FORBIDDEN",
      fieldKey: "checked",
    });
  });

  it("沒有 edit 的人改 input 子欄 → 403", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    const [first] = rowsOf(view, "checked");
    const result = await call(api, plain.token, UPDATE_SUBMISSION, {
      input: {
        id: view.id,
        expectedEditVersion: view.editVersion,
        expectedRevision: view.revision,
        values: { ...view.values, checked: [{ ...first, item: "改掉" }] },
      },
    });
    expect(codeOf(result)).toBe("FORBIDDEN");
  });

  it("沒有 edit 的必填明細對此人免驗:可留空送出", async () => {
    const created = await createSubmitted(api, plain.token, FORM, {
      title: "沒有勾選權限的人",
      show_items: false,
    });
    expect(created.values.checked).toBeNull();
  });

  it("修訂遮蔽:沒有 show 的人讀以前的修訂,受保護明細也是 [redacted]", async () => {
    const view = await getSubmission(api, plain.token, submission.id, 1);
    expect(view.values.costs).toBe("[redacted]");
  });

  it("沒有 edit 的人只改列的順序 → 403", async () => {
    const view = await getSubmission(api, plain.token, submission.id);
    const result = await call(api, plain.token, UPDATE_SUBMISSION, {
      input: {
        id: view.id,
        expectedEditVersion: view.editVersion,
        expectedRevision: view.revision,
        values: {
          ...view.values,
          checked: rowsOf(view, "checked").toReversed(),
        },
      },
    });
    expect(extensionsOf(result)).toMatchObject({
      code: "FORBIDDEN",
      fieldKey: "checked",
    });
  });

  it("沒有 edit 的人不送明細:保留的列其列內公式子欄仍由後端重算", async () => {
    const created = await createSubmitted(
      api,
      author.token,
      FORM,
      baseValues(),
    );
    const view = await getSubmission(api, plain.token, created.id);
    const values: Record<string, unknown> = { ...view.values, multiplier: 5 };
    Reflect.deleteProperty(values, "packed");
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, plain.token, UPDATE_SUBMISSION, {
      input: {
        id: view.id,
        expectedEditVersion: view.editVersion,
        expectedRevision: view.revision,
        values,
      },
    });
    expect(
      rowsOf(updated.updateFormSubmission.submission, "packed").map(
        (row) => row.scaled,
      ),
    ).toEqual(["15"]);
  });

  it("修訂差異:以 rowId 對列標示新增 / 刪除 / 移動 / 改值", async () => {
    const C = randomUUID();
    const D = randomUUID();
    const first = await createSubmitted(
      api,
      author.token,
      FORM,
      baseValues({
        items: [
          itemRow(A, { qty: 1 }),
          itemRow(B, { qty: 1 }),
          itemRow(C, { qty: 1 }),
        ],
      }),
    );
    await ok(api, author.token, UPDATE_SUBMISSION, {
      input: {
        id: first.id,
        expectedEditVersion: first.editVersion,
        expectedRevision: first.revision,
        values: {
          ...first.values,
          items: [
            itemRow(B, { qty: 5 }),
            itemRow(A, { qty: 1 }),
            itemRow(D, { qty: 1 }),
          ],
        },
      },
    });
    const before = await getSubmission(api, author.token, first.id, 1);
    const after = await getSubmission(api, author.token, first.id, 2);
    expect(
      arrayRowChanges(items, before.values.items, after.values.items).map(
        (change) => [
          change.rowId,
          change.kind,
          change.isMoved,
          change.changedColumns,
        ],
      ),
    ).toEqual([
      [B, "kept", true, ["qty"]],
      [D, "added", false, []],
      [C, "removed", false, []],
    ]);
  });
});
