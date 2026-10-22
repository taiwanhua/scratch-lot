import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import { type FieldDef, settleHidden } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  FORM_LOOKUP,
  FORM_LOOKUP_RECORD,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  PASSWORD,
  PREVIEW_VERSION,
  SUBMIT,
  type SubmissionRow,
  VALIDATE_VERSION,
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
  publishDefinition,
  publishNewForm,
  rawSubmission,
  rootToken,
  saveDefinition,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const CREATE_UPLOAD_URL = /* GraphQL */ `
  mutation CreateUploadUrl($input: CreateUploadUrlInput!) {
    createUploadUrl(input: $input) {
      objectPath
    }
  }
`;

/** 預覽指定版本用:`total = qty × factor`(每一版 factor 不同,結果看得出算的是哪一版)。 */
function doubled(factor: number): ReturnType<typeof definitionOf> {
  return definitionOf([
    field("title", "text"),
    field("qty", "number"),
    field("total", "number", {
      valueSource: {
        kind: "computed",
        expr: { "*": [{ var: "qty" }, factor] },
      },
    }),
  ]);
}

const ATTACHMENT_URL = /* GraphQL */ `
  query FormSubmissionAttachmentUrl($id: ID!, $fieldKey: String!) {
    formSubmissionAttachmentUrl(id: $id, fieldKey: $fieldKey) {
      url
    }
  }
`;

interface LookupRow {
  id: string;
  value: string | null;
  label: string | null;
  values: Record<string, unknown>;
}

/**
 * 值的語意:
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("表單的值:語意值、引用快照、現名 / 快照、lookup 以定義為準", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let otherTenant: Types.ObjectId;
  let staff: FormOperator;
  let colleague: Types.ObjectId;
  let outsider: Types.ObjectId;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-values");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "值的租戶" });
    otherTenant = await createOrg(connection, { name: "別的租戶" });
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
    colleague = await createUser(connection, {
      account: "colleague",
      password: PASSWORD,
      orgIds: [tenant],
    });
    outsider = await createUser(connection, {
      account: "outsider",
      password: PASSWORD,
      orgIds: [otherTenant],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it('表達式拿到語意值:類別選項存 { value, label },條件 `kind == "drink"` 照樣成立;選項 label 送出時重取', async () => {
    await publishNewForm(
      api,
      root,
      "semantic",
      definitionOf([
        field("title", "text"),
        field("kind", "select", {
          options: { kind: "fieldCategory", key: "demo-category" },
        }),
        field("drink_note", "text", {
          visibleWhen: { "==": [{ var: "kind" }, "drink"] },
        }),
        field("kind_label", "text", {
          valueSource: {
            kind: "computed",
            expr: { concat: ["類別:", { optionLabel: "kind" }] },
          },
        }),
      ]),
    );
    await assignForm(api, root, "semantic", [tenant]);
    const submitted = await createSubmitted(api, staff.token, "semantic", {
      title: "飲料",
      kind: { value: "drink", label: "前端亂給的 label" },
      drink_note: "要冰的",
    });
    expect(submitted.values.kind).toEqual({ value: "drink", label: "飲品" });
    expect(submitted.values.drink_note).toBe("要冰的");
    expect(submitted.values.kind_label).toBe("類別:飲品");
    expect(
      submitted.fieldStates.find((state) => state.key === "drink_note")
        ?.visible,
    ).toBe(true);
    // 不在類別裡的值 → 擋下
    const draft = await createDraft(api, staff.token, "semantic", {
      title: "亂選",
      kind: "not-a-category-value",
    });
    const invalid = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(extensionsOf(invalid).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "kind", code: "OPTION_INVALID" }),
    );
  });

  describe("引用(reference)", () => {
    let submitted: SubmissionRow;

    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "ref_form",
        definitionOf([
          field("title", "text"),
          field("owner", "reference", {
            source: { provider: "user", labelField: "name" },
          }),
        ]),
      );
      await assignForm(api, root, "ref_form", [tenant]);
      submitted = await createSubmitted(api, staff.token, "ref_form", {
        title: "找同事",
        owner: { id: String(colleague), label: "前端給的名字" },
      });
    }, HOOK_TIMEOUT_MS);

    it("送出時重驗來源可讀並重取 label 寫快照", async () => {
      expect(submitted.values.owner).toEqual({
        id: String(colleague),
        label: "colleague",
      });
      const draft = await createDraft(api, staff.token, "ref_form", {
        title: "引用別租戶的人",
        owner: String(outsider),
      });
      const result = await call(api, staff.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fieldErrors).toContainEqual(
        expect.objectContaining({
          fieldKey: "owner",
          code: "SOURCE_UNAVAILABLE",
        }),
      );
    });

    it("顯示名:來源還在 → 現名;來源已刪 → 快照 + available false;存的快照不變", async () => {
      await connection
        .collection("users")
        .updateOne({ _id: colleague }, { $set: { name: "改名後的同事" } });
      const renamed = await getSubmission(api, staff.token, submitted.id);
      expect(renamed.displayValues).toEqual([
        {
          fieldKey: "owner",
          items: [
            {
              value: String(colleague),
              label: "改名後的同事",
              available: true,
            },
          ],
        },
      ]);
      expect(renamed.values.owner).toEqual({
        id: String(colleague),
        label: "colleague",
      });
      await connection
        .collection("users")
        .updateOne({ _id: colleague }, { $set: { deletedAt: new Date() } });
      const gone = await getSubmission(api, staff.token, submitted.id);
      expect(gone.displayValues[0]?.items).toEqual([
        { value: String(colleague), label: "colleague", available: false },
      ]);
      await connection
        .collection("users")
        .updateOne({ _id: colleague }, { $set: { deletedAt: null } });
    });
  });

  it("lookup 的 provider / filter 只認版本定義:前端只帶目標與關鍵字,帶不了 provider;定義的 filter 後端套", async () => {
    const disabledOrg = await createOrg(connection, {
      name: "值的租戶-停用部門",
      parentId: tenant,
    });
    await connection
      .collection("orgs")
      .updateOne({ _id: disabledOrg }, { $set: { enabled: false } });
    await createOrg(connection, {
      name: "值的租戶-啟用部門",
      parentId: tenant,
    });
    await publishNewForm(
      api,
      root,
      "lookup_form",
      definitionOf([
        field("title", "text"),
        field("dept", "select", {
          widget: { kind: "autocomplete" },
          options: {
            kind: "lookup",
            source: {
              provider: "org",
              labelField: "name",
              filter: { enabled: true },
            },
          },
        }),
      ]),
    );
    await assignForm(api, root, "lookup_form", [tenant]);
    // 租戶開「使用者可見下層組織資料」:員工的可見範圍才含兩個部門
    await connection
      .collection("orgs")
      .updateOne(
        { _id: tenant },
        { $set: { "settings.visibility": "subtree" } },
      );
    const found = await ok<{ formLookup: { items: LookupRow[] } }>(
      api,
      staff.token,
      FORM_LOOKUP,
      {
        input: {
          formKey: "lookup_form",
          version: 1,
          target: { fieldKey: "dept" },
          keyword: "值的租戶-",
        },
      },
    );
    expect(found.formLookup.items.map((item) => item.label)).toEqual([
      "值的租戶-啟用部門",
    ]);
    // 可見範圍外(別的租戶)查不到
    const outside = await ok<{ formLookup: { items: LookupRow[] } }>(
      api,
      staff.token,
      FORM_LOOKUP,
      {
        input: {
          formKey: "lookup_form",
          version: 1,
          target: { fieldKey: "dept" },
          keyword: "別的租戶",
        },
      },
    );
    expect(outside.formLookup.items).toEqual([]);
    // input 上沒有 provider / filter 這種欄位:硬塞就被 schema 擋下
    const forged = await call(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: "lookup_form",
        version: 1,
        target: { fieldKey: "dept" },
        provider: "user",
      },
    });
    expect(forged.errors).toBeDefined();
    // 沒有 lookup 來源的欄位不能當目標
    const notLookup = await call(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: "lookup_form",
        version: 1,
        target: { fieldKey: "title" },
      },
    });
    expect(extensionsOf(notLookup).fields).toEqual(["target"]);
  });

  it("`form_submission` 來源依每筆自己的版本判斷欄位:受保護無權省略、舊版本沒有的回 null", async () => {
    // 來源表單 v1:title / note 都公開
    await publishNewForm(
      api,
      root,
      "src_form",
      definitionOf([field("title", "text"), field("note", "text")]),
    );
    await assignForm(api, root, "src_form", [tenant]);
    const onV1 = await createSubmitted(api, staff.token, "src_form", {
      title: "舊版的單",
      note: "v1 的備註",
    });
    // 目標表單在 v1 時設計:帶入 note / title
    await ok(api, root, CREATE_FORM, {
      input: { key: "dst_form", moduleKey: MODULE_KEY, name: "帶入目標" },
    });
    const dstDraft = await ok<{
      createFormVersionDraft: { formVersion: { draftRevision: number } };
    }>(api, root, CREATE_DRAFT, { input: { formKey: "dst_form" } });
    const prefillSource = {
      provider: "form_submission",
      formKey: "src_form",
      labelField: "title",
    };
    const dstV1 = definitionOf(
      [field("t", "text"), field("n", "text"), field("e", "text")],
      {
        prefills: [
          {
            label: "從來源帶入",
            source: prefillSource,
            mapping: [
              { sourceField: "title", fieldKey: "t" },
              { sourceField: "note", fieldKey: "n" },
            ],
          },
        ],
      },
    );
    await saveDefinition(
      api,
      root,
      "dst_form",
      dstV1,
      dstDraft.createFormVersionDraft.formVersion.draftRevision,
    );
    await ok(
      api,
      root,
      "mutation P($input: PublishFormVersionInput!) { publishFormVersion(input: $input) { formVersion { version } } }",
      {
        input: {
          formKey: "dst_form",
          expectedDraftRevision: 1,
          changelog: "v1",
        },
      },
    );
    await assignForm(api, root, "dst_form", [tenant]);

    // 來源表單 v2:note 改成受保護,另加 extra
    await publishDefinition(
      api,
      root,
      "src_form",
      definitionOf([
        field("title", "text"),
        field("note", "text", { permission: { show: true, edit: false } }),
        field("extra", "text"),
      ]),
      1,
    );
    const writer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, showKey("src_form", "note")],
    });
    const onV2 = await createSubmitted(api, writer.token, "src_form", {
      title: "新版的單",
      note: "v2 的機密備註",
      extra: "v2 才有",
    });

    const lookupDst = async (
      version: number,
    ): Promise<Map<string, LookupRow>> => {
      const data = await ok<{ formLookup: { items: LookupRow[] } }>(
        api,
        staff.token,
        FORM_LOOKUP,
        {
          input: {
            formKey: "dst_form",
            version,
            target: { prefillIndex: 0 },
          },
        },
      );
      return new Map(data.formLookup.items.map((item) => [item.id, item]));
    };
    const v1Rows = await lookupDst(1);
    expect(v1Rows.get(onV1.id)).toMatchObject({
      label: "舊版的單",
      values: { title: "舊版的單", note: "v1 的備註" },
    });
    // v2 的那筆:note 受保護且 staff 沒有 show → 省略(不是 null)
    expect(v1Rows.get(onV2.id)?.values).toEqual({ title: "新版的單" });

    // 目標表單改版:加帶入 extra(v2 才有的欄位)
    await publishDefinition(
      api,
      root,
      "dst_form",
      definitionOf(
        [field("t", "text"), field("n", "text"), field("e", "text")],
        {
          prefills: [
            {
              label: "從來源帶入",
              source: prefillSource,
              mapping: [
                { sourceField: "title", fieldKey: "t" },
                { sourceField: "extra", fieldKey: "e" },
              ],
            },
          ],
        },
      ),
      1,
    );
    const v2Rows = await lookupDst(2);
    expect(v2Rows.get(onV1.id)?.values).toEqual({
      title: "舊版的單",
      extra: null,
    });
    expect(v2Rows.get(onV2.id)?.values).toEqual({
      title: "新版的單",
      extra: "v2 才有",
    });
    const single = await ok<{ formLookupRecord: { record: LookupRow | null } }>(
      api,
      staff.token,
      FORM_LOOKUP_RECORD,
      {
        input: {
          formKey: "dst_form",
          version: 2,
          target: { prefillIndex: 0 },
          id: onV2.id,
        },
      },
    );
    expect(single.formLookupRecord.record?.values).toMatchObject({
      extra: "v2 才有",
    });
  });

  it("帶入來源可以是自己:設計時以草稿欄位檢查(還沒發布也行),執行時以那筆提交綁的版本回值", async () => {
    await ok(api, root, CREATE_FORM, {
      input: { key: "self_form", moduleKey: MODULE_KEY, name: "自己帶自己" },
    });
    const selfSource = {
      provider: "form_submission",
      formKey: "self_form",
      labelField: "title",
    };
    const selfDefinition = (mappedFrom: string) =>
      definitionOf([field("title", "text"), field("note", "text")], {
        prefills: [
          {
            label: "從上一張帶入",
            source: selfSource,
            mapping: [{ sourceField: mappedFrom, fieldKey: "note" }],
          },
        ],
      });
    const report = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: { formKey: "self_form", ...selfDefinition("note") },
    });
    // 從沒發布過:欄位目錄用這份草稿的欄位,note 找得到
    expect(report.validateFormVersion.errors).toEqual([]);
    const unknown = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: { formKey: "self_form", ...selfDefinition("missing") },
    });
    expect(unknown.validateFormVersion.errors).toContainEqual(
      expect.objectContaining({
        location: expect.objectContaining({ prefillIndex: 0 }),
      }),
    );

    // 選項來源指到自己不走草稿目錄:照一般規則看已發布版(還沒發布 = 只有摘要槽),note 找不到
    const optionSelf = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: "self_form",
        ...definitionOf([
          field("title", "text"),
          field("note", "text"),
          field("pick", "select", {
            widget: { kind: "dropdown" },
            options: {
              kind: "lookup",
              source: { ...selfSource, labelField: "note" },
            },
          }),
        ]),
      },
    });
    expect(optionSelf.validateFormVersion.errors).toContainEqual(
      expect.objectContaining({
        code: "LOOKUP_UNKNOWN_FIELD",
        location: expect.objectContaining({ fieldKey: "pick" }),
      }),
    );

    await publishDefinition(
      api,
      root,
      "self_form",
      selfDefinition("note"),
      null,
    );
    await assignForm(api, root, "self_form", [tenant]);
    const earlier = await createSubmitted(api, staff.token, "self_form", {
      title: "上一張",
      note: "上次的備註",
    });
    const data = await ok<{ formLookup: { items: LookupRow[] } }>(
      api,
      staff.token,
      FORM_LOOKUP,
      {
        input: {
          formKey: "self_form",
          version: 1,
          target: { prefillIndex: 0 },
        },
      },
    );
    expect(data.formLookup.items).toContainEqual(
      expect.objectContaining({
        id: earlier.id,
        label: "上一張",
        values: { note: "上次的備註" },
      }),
    );
  });

  it("上傳欄:只收本 API 簽出來的 form/ 路徑;附件網址要看得到這筆、看得到這一欄才簽", async () => {
    await publishNewForm(
      api,
      root,
      "upload_form",
      definitionOf([
        field("title", "text"),
        field("file", "upload"),
        field("secret_file", "upload", {
          permission: { show: true, edit: false },
        }),
      ]),
    );
    await assignForm(api, root, "upload_form", [tenant]);
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
    expect(path).toMatch(/^form\//);
    const submitted = await createSubmitted(api, staff.token, "upload_form", {
      title: "有附件",
      file: {
        path,
        name: "報價單.pdf",
        size: 1000,
        contentType: "application/pdf",
      },
    });
    const url = await ok<{ formSubmissionAttachmentUrl: { url: string } }>(
      api,
      staff.token,
      ATTACHMENT_URL,
      { id: submitted.id, fieldKey: "file" },
    );
    expect(url.formSubmissionAttachmentUrl.url).toContain(path);
    const hidden = await call(api, staff.token, ATTACHMENT_URL, {
      id: submitted.id,
      fieldKey: "secret_file",
    });
    expect(extensionsOf(hidden).reason).toBe("FIELD_FORBIDDEN");
    const foreign = await call(api, staff.token, CREATE_FORM_DRAFT, {
      input: {
        formKey: "upload_form",
        clientRequestId: "foreign-upload",
        values: {
          file: {
            path: "demo/11111111-2222-4333-8444-555555555555.png",
            name: "a.png",
            size: 10,
            contentType: "image/png",
          },
        },
      },
    });
    expect(extensionsOf(foreign).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "file", code: "UPLOAD_INVALID" }),
    );
  });

  it("檢查器(不落庫):條件引用受保護欄位 → 錯誤並定位到欄位與表達式槽", async () => {
    await ok(api, root, CREATE_FORM, {
      input: { key: "check_form", moduleKey: MODULE_KEY, name: "檢查" },
    });
    const report = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: "check_form",
        ...definitionOf([
          field("title", "text"),
          field("salary", "number", {
            permission: { show: true, edit: false },
          }),
          field("note", "text", {
            visibleWhen: { ">": [{ var: "salary" }, 0] },
          }),
        ]),
      },
    });
    expect(report.validateFormVersion.errors).toContainEqual({
      code: "EXPR_PROTECTED_REF",
      location: expect.objectContaining({
        fieldKey: "note",
        exprSlot: "visibleWhen",
      }),
    });
  });

  it("設計器預覽:對草稿跑計算與條件,不建提交", async () => {
    await ok(api, root, CREATE_FORM, {
      input: { key: "preview_form", moduleKey: MODULE_KEY, name: "預覽" },
    });
    await ok(api, root, CREATE_DRAFT, { input: { formKey: "preview_form" } });
    await saveDefinition(
      api,
      root,
      "preview_form",
      definitionOf([
        field("title", "text", { rules: { required: true } }),
        field("qty", "number"),
        field("double", "number", {
          valueSource: { kind: "computed", expr: { "*": [{ var: "qty" }, 2] } },
        }),
        field("big_note", "text", {
          visibleWhen: { ">": [{ var: "qty" }, 10] },
        }),
      ]),
      0,
    );
    const before = await connection
      .collection("form_submissions")
      .countDocuments();
    const preview = await ok<{
      previewFormVersion: {
        values: Record<string, unknown>;
        fieldStates: { key: string; visible: boolean }[];
        fieldErrors: { fieldKey: string; code: string }[];
      };
    }>(api, root, PREVIEW_VERSION, {
      input: { formKey: "preview_form", values: { qty: 3, big_note: "x" } },
    });
    expect(preview.previewFormVersion.values).toMatchObject({
      double: "6",
      big_note: null,
    });
    expect(
      preview.previewFormVersion.fieldStates.find(
        (state) => state.key === "big_note",
      )?.visible,
    ).toBe(false);
    expect(preview.previewFormVersion.fieldErrors).toEqual([
      expect.objectContaining({ fieldKey: "title", code: "REQUIRED" }),
    ]);
    expect(
      await connection.collection("form_submissions").countDocuments(),
    ).toBe(before);
  });

  it("隱藏的欄位當 null 算:後端存的值 = 前端預覽(domain `settleHidden`)算出的值", async () => {
    const hiddenFields: FieldDef[] = [
      field("title", "text"),
      field("has_discount", "boolean"),
      field("discount", "number", {
        visibleWhen: { "==": [{ var: "has_discount" }, true] },
      }),
      field("price", "number"),
      field("net", "number", {
        valueSource: {
          kind: "computed",
          expr: { "-": [{ var: "price" }, { var: "discount" }] },
        },
      }),
      field("doubled", "number", {
        valueSource: {
          kind: "computed",
          expr: { "*": [{ var: "price" }, 2] },
        },
        visibleWhen: { "==": [{ var: "has_discount" }, true] },
      }),
      field("plus_one", "number", {
        valueSource: {
          kind: "computed",
          expr: { "+": [{ var: "doubled" }, 1] },
        },
      }),
    ];
    await ok(api, root, CREATE_FORM, {
      input: { key: "hidden_null", moduleKey: MODULE_KEY, name: "隱藏當空" },
    });
    await ok(api, root, CREATE_DRAFT, { input: { formKey: "hidden_null" } });
    await saveDefinition(
      api,
      root,
      "hidden_null",
      definitionOf(hiddenFields),
      0,
    );
    const values = {
      title: "折扣",
      has_discount: false,
      discount: "30",
      price: "100",
    };
    const preview = await ok<{
      previewFormVersion: { values: Record<string, unknown> };
    }>(api, root, PREVIEW_VERSION, {
      input: { formKey: "hidden_null", values },
    });
    const frontend = settleHidden(hiddenFields, {
      values,
      ctx: {
        now: new Date().toISOString(),
        timezone: "Asia/Taipei",
        user: { id: "root", orgId: "root", orgIds: ["root"] },
        tenant: { id: null },
      },
    });

    expect(preview.previewFormVersion.values).toMatchObject({
      discount: null,
      net: null,
      doubled: null,
      plus_one: null,
    });
    expect(preview.previewFormVersion.values).toMatchObject(frontend.values);
  });

  it("設計器預覽帶 version:以那一版(已發布 / 已退役)的定義計算,不是草稿", async () => {
    await publishNewForm(api, root, "preview_versions", doubled(2));
    await publishDefinition(api, root, "preview_versions", doubled(3), 1);
    await ok(api, root, CREATE_DRAFT, {
      input: { formKey: "preview_versions", baseVersion: 2 },
    });
    await saveDefinition(api, root, "preview_versions", doubled(10), 0);
    const totalOf = async (version: number | null): Promise<unknown> => {
      const data = await ok<{
        previewFormVersion: { values: Record<string, unknown> };
      }>(api, root, PREVIEW_VERSION, {
        input: {
          formKey: "preview_versions",
          values: { qty: 4 },
          ...(version !== null && { version }),
        },
      });
      return data.previewFormVersion.values.total;
    };
    // 版本 1 已退役、版本 2 是目前版本、草稿乘 10
    expect(await totalOf(1)).toBe("8");
    expect(await totalOf(2)).toBe("12");
    expect(await totalOf(null)).toBe("40");
    const missing = await call(api, root, PREVIEW_VERSION, {
      input: { formKey: "preview_versions", version: 9, values: {} },
    });
    expect(codeOf(missing)).toBe("NOT_FOUND");
  });

  describe("引用的快照只取非受保護欄位;顯示欄被遮時標來源不可用", () => {
    let shower: FormOperator;
    let refToProtected: SubmissionRow;

    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "lbl_src",
        definitionOf([field("title", "text"), field("note", "text")]),
      );
      await assignForm(api, root, "lbl_src", [tenant]);
      await publishNewForm(
        api,
        root,
        "lbl_dst",
        definitionOf([
          field("title", "text"),
          field("pick", "reference", {
            source: {
              provider: "form_submission",
              formKey: "lbl_src",
              labelField: "note",
            },
          }),
        ]),
      );
      await assignForm(api, root, "lbl_dst", [tenant]);
      // 來源表單改版:note 變成受保護
      await publishDefinition(
        api,
        root,
        "lbl_src",
        definitionOf([
          field("title", "text"),
          field("note", "text", { permission: { show: true, edit: false } }),
        ]),
        1,
      );
      shower = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.view, M.create, M.edit, showKey("lbl_src", "note")],
      });
      const protectedSource = await createSubmitted(
        api,
        shower.token,
        "lbl_src",
        { title: "新版來源", note: "新版的機密備註" },
      );
      // 有 show 的人送出引用:快照不能把受保護欄位的值帶進非受保護的引用欄
      refToProtected = await createSubmitted(api, shower.token, "lbl_dst", {
        title: "引用新版來源",
        pick: protectedSource.id,
      });
    }, HOOK_TIMEOUT_MS);

    it("有 show 的人送出:引用快照不含受保護欄位的值", async () => {
      expect(refToProtected.values.pick).toMatchObject({ label: null });
      const raw = await rawSubmission(connection, refToProtected.id);
      expect(JSON.stringify(raw)).not.toContain("新版的機密備註");
    });

    it("讀得到那筆但顯示欄被遮:回快照 + available false(不是 null + available true)", async () => {
      const forStaff = await getSubmission(api, staff.token, refToProtected.id);
      expect(forStaff.displayValues).toEqual([
        {
          fieldKey: "pick",
          items: [
            {
              value: expect.any(String) as unknown,
              label: null,
              available: false,
            },
          ],
        },
      ]);
      // 有 show 的讀者看到現名
      const forShower = await getSubmission(
        api,
        shower.token,
        refToProtected.id,
      );
      expect(forShower.displayValues[0]?.items[0]).toMatchObject({
        label: "新版的機密備註",
        available: true,
      });
    });
  });

  it("user 來源以帳號當值反查要能看使用者管理:沒有就選不到", async () => {
    await publishNewForm(
      api,
      root,
      "user_acct",
      definitionOf([
        field("title", "text"),
        field("who", "select", {
          options: {
            kind: "lookup",
            source: {
              provider: "user",
              labelField: "name",
              valueField: "account",
            },
          },
        }),
      ]),
    );
    await assignForm(api, root, "user_acct", [tenant]);
    const draft = await createDraft(api, staff.token, "user_acct", {
      title: "用帳號選人",
      who: "colleague",
    });
    const result = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(extensionsOf(result).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "who", code: "OPTION_INVALID" }),
    );
    // 超級管理員有使用者管理的檢視:選得到
    const byRoot = await createSubmitted(api, root, "user_acct", {
      title: "root 用帳號選人",
      who: "colleague",
    });
    expect(byRoot.values.who).toMatchObject({ value: "colleague" });
  });

  describe("列表欄位配置(modules.settings.list)", () => {
    const SET_COLUMNS = /* GraphQL */ `
      mutation SetModuleListColumns($input: SetModuleListColumnsInput!) {
        setModuleListColumns(input: $input) {
          moduleKey
          columns {
            kind
            key
            formKey
            width
            order
          }
        }
      }
    `;
    const GET_COLUMNS = /* GraphQL */ `
      query ModuleListColumns($moduleKey: String!) {
        moduleListColumns(moduleKey: $moduleKey) {
          columns {
            kind
            key
            formKey
            width
            order
          }
        }
      }
    `;

    it("root 整份覆蓋;欄位要存在於共用表單目前版本且不是受保護欄位;使用者讀得到", async () => {
      const saved = await ok<{
        setModuleListColumns: { columns: Record<string, unknown>[] };
      }>(api, root, SET_COLUMNS, {
        input: {
          moduleKey: MODULE_KEY,
          columns: [
            { kind: "FIELD", key: "title", width: 200, order: 2 },
            { kind: "SLOT", key: "date", width: 120, order: 1 },
            // 單號(serialNo)與摘要槽同一種欄
            { kind: "SLOT", key: "serialNo", width: 160, order: 3 },
          ],
        },
      });
      expect(saved.setModuleListColumns.columns.map((c) => c.key)).toEqual([
        "date",
        "title",
        "serialNo",
      ]);
      const read = await ok<{
        moduleListColumns: { columns: { key: string; kind: string }[] };
      }>(api, staff.token, GET_COLUMNS, { moduleKey: MODULE_KEY });
      expect(read.moduleListColumns.columns).toEqual([
        expect.objectContaining({ kind: "SLOT", key: "date" }),
        expect.objectContaining({ kind: "FIELD", key: "title", formKey: null }),
        expect.objectContaining({ kind: "SLOT", key: "serialNo" }),
      ]);

      const protectedColumn = await call(api, root, SET_COLUMNS, {
        input: {
          moduleKey: MODULE_KEY,
          columns: [
            {
              kind: "FIELD",
              key: "note",
              formKey: "lbl_src",
              width: 100,
              order: 1,
            },
          ],
        },
      });
      expect(codeOf(protectedColumn)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(protectedColumn).fields).toEqual(["columns.0"]);
      expect(extensionsOf(protectedColumn).reason).toBe(
        "LIST_COLUMN_PROTECTED",
      );
      const unknown = await call(api, root, SET_COLUMNS, {
        input: {
          moduleKey: MODULE_KEY,
          columns: [{ kind: "FIELD", key: "no_such", width: 100, order: 1 }],
        },
      });
      expect(codeOf(unknown)).toBe("VALIDATION_FAILED");
      const badSlot = await call(api, root, SET_COLUMNS, {
        input: {
          moduleKey: MODULE_KEY,
          columns: [{ kind: "SLOT", key: "nope", width: 100, order: 1 }],
        },
      });
      expect(codeOf(badSlot)).toBe("VALIDATION_FAILED");
      // 租戶內的人即使有表單管理權限也不能改(全域預設由 root 管)
      const tenantAdmin = await createOperator(api, connection, {
        orgId: tenant,
        moduleKeys: ["system", "system.forms", MODULE_KEY],
        permissionKeys: ["system.forms.*", M.view],
      });
      const denied = await call(api, tenantAdmin.token, SET_COLUMNS, {
        input: { moduleKey: MODULE_KEY, columns: [] },
      });
      expect(extensionsOf(denied).reason).toBe("ROOT_ONLY");
    });
  });
});
