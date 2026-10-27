import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_FORM_DRAFT,
  DELETE_SUBMISSION,
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  RETIRE_CURRENT,
  SAVE_FORM_DRAFT,
  SUBMIT,
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
  getForm,
  getSubmission,
  nextRequestId,
  ok,
  publishDefinition,
  publishNewForm,
  rawSubmission,
  rootToken,
  showKey,
  submitDraft,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface FieldError {
  fieldKey: string;
  code: string;
}

/** 採購表單的定義;`owner_note` 只在 staff 本人送出 / 修改時顯示(驗 ctx 依修訂)。 */
function definition(staffId: string): FormDefinition {
  return definitionOf(
    [
      field("title", "text", { rules: { required: true } }),
      field("qty", "number", { rules: { required: true, min: 1 } }),
      field("unit_price", "number", { precision: 2 }),
      field("total", "number", {
        precision: 2,
        valueSource: {
          kind: "computed",
          expr: { "*": [{ var: "qty" }, { var: "unit_price" }] },
        },
        rules: { required: true },
      }),
      field("internal", "text", {
        permission: { show: true, edit: false },
        rules: { required: true },
      }),
      field("reason", "text", {
        visibleWhen: { ">": [{ var: "qty" }, 5] },
      }),
      field("secret", "text", {
        permission: { show: true, edit: false },
        visibleWhen: { ">": [{ var: "qty" }, 100] },
      }),
      field("locked", "text", {
        readonlyWhen: { ">": [{ var: "qty" }, 10] },
      }),
      field("owner_note", "text", {
        visibleWhen: { "==": [{ var: "ctx.user.id" }, staffId] },
      }),
    ],
    { summaryMap: { title: "title", amount: "total" } },
  );
}

interface ListData {
  formSubmissions: { items: SubmissionRow[]; totalCount: number };
}

/**
 * 表單提交:真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("表單提交:草稿 / 送出 / 修訂、四種寫入行為、樂觀鎖與冪等", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  /** 一般員工:模組 view / create / edit,沒有「內部」欄位的 show。 */
  let staff: FormOperator;
  /** 主管:再加內部欄位的 show(看得到但沒有 edit-…,仍可改,因該欄沒設 edit)。 */
  let manager: FormOperator;
  /** 只能新增,不能改已完成的。 */
  let creator: FormOperator;

  const FORM = "purchase";

  async function saveDraft(
    token: string,
    draft: SubmissionRow,
    values: Record<string, unknown>,
  ): Promise<SubmissionRow> {
    const data = await ok<{ saveFormDraft: { submission: SubmissionRow } }>(
      api,
      token,
      SAVE_FORM_DRAFT,
      {
        input: { id: draft.id, expectedEditVersion: draft.editVersion, values },
      },
    );
    return data.saveFormDraft.submission;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-submissions");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "採購租戶" });
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
    creator = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create],
    });
    await publishNewForm(api, root, FORM, definition(String(staff.userId)));
    await assignForm(api, root, FORM, [tenant]);
    manager = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [
        M.view,
        M.create,
        M.edit,
        M.delete,
        showKey(FORM, "internal"),
        showKey(FORM, "secret"),
      ],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("提交綁版本:新增綁 currentVersion;改版後舊草稿仍綁舊版且可送出(寬鬆)", async () => {
    const oldDraft = await createDraft(api, staff.token, FORM, {
      title: "舊版草稿",
      qty: 2,
      unit_price: "10",
    });
    expect(oldDraft).toMatchObject({
      version: 1,
      status: "DRAFT",
      revision: 0,
    });
    await publishDefinition(
      api,
      root,
      FORM,
      definition(String(staff.userId)),
      1,
    );
    const newDraft = await createDraft(api, staff.token, FORM, {
      title: "新版草稿",
    });
    expect(newDraft.version).toBe(2);
    const submitted = await submitDraft(api, staff.token, oldDraft);
    expect(submitted).toMatchObject({
      version: 1,
      status: "COMPLETED",
      revision: 1,
    });
  });

  it("computed 後端重算並以後端為準;必填的計算結果算成 null → 擋下(「無法計算」)", async () => {
    const draft = await createDraft(api, staff.token, FORM, {
      title: "計算",
      qty: 3,
      unit_price: "2.5",
      total: "999",
    });
    expect(draft.values.total).toBe("7.50");
    const noPrice = await saveDraft(staff.token, draft, {
      title: "計算",
      qty: 3,
      unit_price: null,
    });
    // 草稿放寬:算不出來也存得了
    expect(noPrice.values.total).toBeNull();
    const result = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: noPrice.editVersion },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "total", code: "NOT_COMPUTABLE" }),
    );
  });

  it("原因 1 隱藏 → 清空;與受保護同時成立時仍是清空(不 403)", async () => {
    const draft = await createDraft(api, staff.token, FORM, {
      title: "隱藏",
      qty: 3,
      unit_price: "1",
      reason: "數量少時看不到",
      secret: "沒權限又被隱藏",
    });
    expect(draft.values.reason).toBeNull();
    const raw = await rawSubmission(connection, draft.id);
    expect(raw?.values).toMatchObject({ reason: null, secret: null });
  });

  it("原因 3 無 edit 資格:送來不同的值 → 403(草稿也一樣守);沒送、原樣送回遮蔽字串都算沒動", async () => {
    const created = await call(api, staff.token, CREATE_FORM_DRAFT, {
      input: {
        formKey: FORM,
        clientRequestId: nextRequestId(),
        values: { title: "偷寫", internal: "我不該能寫" },
      },
    });
    expect(codeOf(created)).toBe("FORBIDDEN");
    expect(extensionsOf(created)).toMatchObject({
      reason: "FIELD_FORBIDDEN",
      fieldKey: "internal",
    });
    const draft = await createDraft(api, staff.token, FORM, { title: "守門" });
    expect(draft.values.internal).toBe("[redacted]");
    const echoed = await saveDraft(staff.token, draft, {
      title: "守門",
      internal: "[redacted]",
    });
    expect(echoed.editVersion).toBe(draft.editVersion + 1);
  });

  it("無 edit 資格者對受保護的必填欄留空也送得出去;有 show 的主管之後補值", async () => {
    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "受保護必填",
      qty: 2,
      unit_price: "3",
    });
    expect(submitted.status).toBe("COMPLETED");
    const forManager = await getSubmission(api, manager.token, submitted.id);
    expect(forManager.values.internal).toBeNull();
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, manager.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: forManager.editVersion,
        expectedRevision: forManager.revision,
        values: { ...forManager.values, internal: "主管補上" },
      },
    });
    expect(updated.updateFormSubmission.submission.values.internal).toBe(
      "主管補上",
    );
    // 主管修改時必填全驗:清掉受保護必填欄 → 擋下
    const cleared = await call(api, manager.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion:
          updated.updateFormSubmission.submission.editVersion,
        expectedRevision: 2,
        values: { ...forManager.values, internal: null },
      },
    });
    expect(
      (extensionsOf(cleared).fieldErrors as FieldError[]).map(
        (issue) => issue.fieldKey,
      ),
    ).toContain("internal");
  });

  it("原因 4 readonlyWhen:保留既有值、送來的忽略", async () => {
    const draft = await createDraft(api, staff.token, FORM, {
      title: "唯讀",
      qty: 2,
      unit_price: "1",
      locked: "原值",
    });
    const locked = await saveDraft(staff.token, draft, {
      title: "唯讀",
      qty: 20,
      unit_price: "1",
      locked: "想改",
    });
    expect(locked.values.locked).toBe("原值");
    expect(
      locked.fieldStates.find((state) => state.key === "locked")?.readonly,
    ).toBe(true);
  });

  it("`expectedEditVersion` / `expectedRevision` 不符 → 409;兩個分頁同時存,後存的被擋", async () => {
    const draft = await createDraft(api, staff.token, FORM, { title: "鎖" });
    await saveDraft(staff.token, draft, { title: "第一個分頁" });
    const second = await call(api, staff.token, SAVE_FORM_DRAFT, {
      input: {
        id: draft.id,
        expectedEditVersion: draft.editVersion,
        values: { title: "第二個分頁" },
      },
    });
    expect(codeOf(second)).toBe("CONFLICT");
    expect(extensionsOf(second).reason).toBe("EDIT_VERSION_MISMATCH");

    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "修訂鎖",
      qty: 1,
      unit_price: "1",
    });
    const wrongRevision = await call(api, staff.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: 5,
        values: submitted.values,
      },
    });
    expect(extensionsOf(wrongRevision).reason).toBe("REVISION_MISMATCH");
    const wrongEdit = await call(api, staff.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: 0,
        expectedRevision: 1,
        values: submitted.values,
      },
    });
    expect(extensionsOf(wrongEdit).reason).toBe("EDIT_VERSION_MISMATCH");
  });

  it("`clientRequestId` 重試回同一筆;同一個 id 拿去建別張表單 → 409", async () => {
    const requestId = nextRequestId();
    const first = await createDraft(
      api,
      staff.token,
      FORM,
      { title: "a" },
      requestId,
    );
    const retried = await createDraft(
      api,
      staff.token,
      FORM,
      { title: "a" },
      requestId,
    );
    expect(retried.id).toBe(first.id);
    const [left, right] = await Promise.all([
      createDraft(api, staff.token, FORM, {}, "concurrent-request"),
      createDraft(api, staff.token, FORM, {}, "concurrent-request"),
    ]);
    expect(left.id).toBe(right.id);
    const count = await connection
      .collection("form_submissions")
      .countDocuments({ clientRequestId: "concurrent-request" });
    expect(count).toBe(1);
  });

  it("送出 / 修改:修訂號、完整快照與 ctx、editVersion、摘要同一次寫入", async () => {
    const draft = await createDraft(api, staff.token, FORM, {
      title: "快照",
      qty: 2,
      unit_price: "5",
    });
    const submitted = await submitDraft(api, staff.token, draft);
    expect(submitted).toMatchObject({
      status: "COMPLETED",
      revision: 1,
      editVersion: draft.editVersion + 1,
      summary: { title: "快照", amount: "10.00" },
    });
    expect(submitted.ctx?.userId).toBe(String(staff.userId));
    const updated = await ok<{
      updateFormSubmission: { submission: SubmissionRow };
    }>(api, staff.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: 1,
        values: { ...submitted.values, qty: 3 },
      },
    });
    expect(updated.updateFormSubmission.submission).toMatchObject({
      revision: 2,
      summary: { amount: "15.00" },
    });
    const raw = (await rawSubmission(connection, submitted.id)) as {
      revision: number;
      editVersion: number;
      values: Record<string, unknown>;
      revisions: {
        revision: number;
        values: Record<string, unknown>;
        ctx: { userId: unknown; timezone: string };
      }[];
    };
    expect(raw.revision).toBe(2);
    expect(raw.revisions.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(raw.revisions[0]?.values).toMatchObject({
      qty: "2",
      total: "10.00",
    });
    expect(raw.revisions[1]?.values).toEqual(raw.values);
    expect(raw.revisions[1]?.ctx.timezone).toBe("Asia/Taipei");
    // 只能新增的人不能改已完成的
    const denied = await call(api, creator.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: raw.editVersion,
        expectedRevision: 2,
        values: raw.values,
      },
    });
    expect(codeOf(denied)).toBe("FORBIDDEN");
  });

  it("讀修訂 r 用它自己的 ctx 重算條件(不拿讀者的身分補),且不改存值", async () => {
    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "ctx",
      qty: 1,
      unit_price: "1",
      owner_note: "只有 staff 送的那次看得到",
    });
    expect(submitted.values.owner_note).toBe("只有 staff 送的那次看得到");
    await ok(api, manager.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: 1,
        values: submitted.values,
      },
    });
    const before = await rawSubmission(connection, submitted.id);
    const r1 = await getSubmission(api, root, submitted.id, 1);
    expect(r1.viewedRevision).toBe(1);
    expect(r1.values.owner_note).toBe("只有 staff 送的那次看得到");
    expect(
      r1.fieldStates.find((state) => state.key === "owner_note"),
    ).toMatchObject({ visible: true });
    expect(r1.ctx?.userId).toBe(String(staff.userId));
    const r2 = await getSubmission(api, root, submitted.id, 2);
    // 修訂 2 是主管改的:條件以主管為 ctx.user → 不顯示,寫入時已清空
    expect(
      r2.fieldStates.find((state) => state.key === "owner_note"),
    ).toMatchObject({ visible: false });
    expect(r2.values.owner_note).toBeNull();
    expect(await rawSubmission(connection, submitted.id)).toEqual(before);
  });

  it("列表:別人的草稿不列;刪除草稿 = 本人、已完成要 delete", async () => {
    const mine = await createDraft(api, creator.token, FORM, {
      title: "我的草稿",
    });
    const list = await ok<{ formSubmissions: { items: SubmissionRow[] } }>(
      api,
      staff.token,
      FORM_SUBMISSIONS,
      { input: { moduleKey: MODULE_KEY, status: "DRAFT", pageSize: 100 } },
    );
    expect(list.formSubmissions.items.map((item) => item.id)).not.toContain(
      mine.id,
    );
    const othersDraft = await call(api, staff.token, DELETE_SUBMISSION, {
      input: { id: mine.id },
    });
    expect(codeOf(othersDraft)).toBe("NOT_FOUND");
    await ok(api, creator.token, DELETE_SUBMISSION, { input: { id: mine.id } });

    const completed = await createSubmitted(api, creator.token, FORM, {
      title: "已完成",
      qty: 1,
      unit_price: "1",
    });
    expect(completed.abilities).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    const denied = await call(api, creator.token, DELETE_SUBMISSION, {
      input: { id: completed.id },
    });
    expect(codeOf(denied)).toBe("FORBIDDEN");
    await ok(api, manager.token, DELETE_SUBMISSION, {
      input: { id: completed.id },
    });
    const deletedRaw = await rawSubmission(connection, completed.id);
    expect(deletedRaw?.deletedAt).toBeInstanceOf(Date);
  });

  it("列表 `excludeFormKeys`:不列那些表單,總筆數同步;指定的那一張被排除 = 空清單", async () => {
    await createSubmitted(api, staff.token, FORM, {
      title: "要排除的那張",
      qty: 1,
      unit_price: "1",
    });
    const OTHER = "list_other";
    await publishNewForm(
      api,
      root,
      OTHER,
      definitionOf([field("title", "text")]),
    );
    await assignForm(api, root, OTHER, [tenant]);
    await createSubmitted(api, staff.token, OTHER, { title: "留下" });
    const list = (input: Record<string, unknown>) =>
      ok<ListData>(api, staff.token, FORM_SUBMISSIONS, {
        input: { moduleKey: MODULE_KEY, pageSize: 100, ...input },
      });
    const all = await list({});
    const others = await list({ formKey: OTHER });
    const excluded = await list({ excludeFormKeys: [FORM] });
    expect(all.formSubmissions.items.map((item) => item.formKey)).toContain(
      FORM,
    );
    expect(
      new Set(excluded.formSubmissions.items.map((item) => item.formKey)),
    ).toEqual(new Set([OTHER]));
    expect(excluded.formSubmissions.totalCount).toBe(
      others.formSubmissions.totalCount,
    );
    // 分頁:每頁 1 筆時總筆數仍是排除後的數
    const paged = await list({ excludeFormKeys: [FORM], pageSize: 1 });
    expect(paged.formSubmissions.totalCount).toBe(
      others.formSubmissions.totalCount,
    );
    const conflict = await list({ formKey: FORM, excludeFormKeys: [FORM] });
    expect(conflict.formSubmissions).toMatchObject({
      items: [],
      totalCount: 0,
    });
    const other = await list({ formKey: OTHER, excludeFormKeys: [FORM] });
    expect(other.formSubmissions.totalCount).toBe(
      others.formSubmissions.totalCount,
    );
  });

  it("退役目前版本後既有草稿仍可送出(寬鬆),但不能新增", async () => {
    const draft = await createDraft(api, staff.token, FORM, {
      title: "退役前的草稿",
      qty: 1,
      unit_price: "1",
    });
    const { currentVersion } = await getForm(api, root, FORM);
    await ok(api, root, RETIRE_CURRENT, {
      input: { formKey: FORM, expectedVersion: currentVersion },
    });
    const submitted = await submitDraft(api, staff.token, draft);
    expect(submitted.status).toBe("COMPLETED");
    const blocked = await call(api, staff.token, CREATE_FORM_DRAFT, {
      input: { formKey: FORM, clientRequestId: nextRequestId() },
    });
    expect(extensionsOf(blocked).reason).toBe("FORM_NOT_AVAILABLE");
  });

  describe("條件以最終存下的值判定;遮蔽字串與多選的「沒動」", () => {
    const GUARD = "guarded";
    let guardEditor: FormOperator;

    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        GUARD,
        definitionOf([
          field("title", "text"),
          field("lock", "boolean"),
          field("stage", "text", {
            readonlyWhen: { "==": [{ var: "lock" }, true] },
          }),
          field("audit_note", "text", {
            permission: { show: true, edit: false },
            visibleWhen: { "==": [{ var: "stage" }, "x"] },
          }),
          field("tags", "multiSelect", {
            permission: { show: false, edit: true },
          }),
          field("amount", "number", {
            permission: { show: true, edit: false },
          }),
        ]),
      );
      await assignForm(api, root, GUARD, [tenant]);
      guardEditor = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [
          M.view,
          M.create,
          M.edit,
          showKey(GUARD, "audit_note"),
          showKey(GUARD, "amount"),
          editKey(GUARD, "tags"),
        ],
      });
    }, HOOK_TIMEOUT_MS);

    it("送一個會被 readonlyWhen 忽略的值,不能把受保護欄判成隱藏而清掉它的既有值", async () => {
      const submitted = await createSubmitted(api, guardEditor.token, GUARD, {
        title: "有稽核備註",
        lock: false,
        stage: "x",
        audit_note: "機密稽核",
      });
      // staff 看不到 audit_note;同時鎖住 stage 又送一個會被忽略的 stage 值
      await ok(api, staff.token, UPDATE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: submitted.editVersion,
          expectedRevision: submitted.revision,
          values: {
            title: "有稽核備註",
            lock: true,
            stage: "y",
            audit_note: "[redacted]",
          },
        },
      });
      const raw = (await rawSubmission(connection, submitted.id)) as {
        values: Record<string, unknown>;
      };
      expect(raw.values).toMatchObject({
        lock: true,
        stage: "x",
        audit_note: "機密稽核",
      });
    });

    it('看得到該欄的人送 "[redacted]" 不算沒動:走型別驗證(數字欄不合法 → VALIDATION_FAILED)', async () => {
      const result = await call(api, guardEditor.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: GUARD,
          clientRequestId: nextRequestId(),
          values: { title: "x", amount: "[redacted]" },
        },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fieldErrors).toContainEqual(
        expect.objectContaining({ fieldKey: "amount", code: "TYPE_INVALID" }),
      );
    });

    it("多選是集合:沒有 edit 的人把同一組值換順序送回不算改動", async () => {
      const submitted = await createSubmitted(api, guardEditor.token, GUARD, {
        title: "多選",
        tags: ["sick", "annual"],
      });
      const updated = await ok<{
        updateFormSubmission: { submission: SubmissionRow };
      }>(api, staff.token, UPDATE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: submitted.editVersion,
          expectedRevision: submitted.revision,
          values: { ...submitted.values, tags: ["annual", "sick"] },
        },
      });
      expect(updated.updateFormSubmission.submission.values.tags).toEqual([
        "sick",
        "annual",
      ]);
      const changed = await call(api, staff.token, UPDATE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion:
            updated.updateFormSubmission.submission.editVersion,
          expectedRevision: 2,
          values: { ...submitted.values, tags: ["sick"] },
        },
      });
      expect(extensionsOf(changed).reason).toBe("FIELD_FORBIDDEN");
    });
  });
});
