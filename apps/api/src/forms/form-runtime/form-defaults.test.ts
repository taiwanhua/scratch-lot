import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  FORM_UPLOAD_CONTENT_TYPES,
  FORM_UPLOAD_MAX_SIZE_MB,
} from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  UPLOAD_RULES,
  UploadPurpose,
} from "../../storage/upload-rules";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  FORM_LOOKUP,
  FORM_TEST_TIMEOUT_MS,
  FORM_VERSIONS,
  type FormOperator,
  M,
  PUBLISH,
  SAVE_FORM_DRAFT,
  SUBMIT,
  type SubmissionRow,
  UPDATE_SUBMISSION,
  type VersionRow,
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
  ok,
  publishNewForm,
  rawSubmission,
  rootToken,
  saveDefinition,
  showKey,
  simulateInterruptedPublish,
  submitDraft,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const ME_TIMEZONE = /* GraphQL */ `
  query MeTimezone {
    me {
      currentOrg {
        timezone
      }
    }
  }
`;

const DELETE_VERSION_DRAFT = /* GraphQL */ `
  mutation DeleteFormVersionDraft($input: DeleteFormVersionDraftInput!) {
    deleteFormVersionDraft(input: $input) {
      form {
        key
        hasDraft
      }
    }
  }
`;

const uploadOf = (contentType: string, size: number, extension: string) => ({
  path: `form/${randomUUID()}.${extension}`,
  name: `附件.${extension}`,
  size,
  contentType,
});

/**
 * 6a 票 F(#482):欄位預設值、datetime、上傳欄檔型 / 大小上限、型別檢查擋發布、刪除表單草稿。
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("表單預設值、日期時間、上傳上限、型別檢查、刪除草稿", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let staff: FormOperator;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-defaults");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "東京分店",
      settings: { timezone: "Asia/Tokyo" },
    });
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("me.currentOrg.timezone = 讀者當前組織的租戶時區(沒設 = Asia/Taipei)", async () => {
    const data = await ok<{
      me: { currentOrg: { timezone: string } | null };
    }>(api, staff.token, ME_TIMEZONE);
    expect(data.me.currentOrg?.timezone).toBe("Asia/Tokyo");
    const rootData = await ok<{
      me: { currentOrg: { timezone: string } | null };
    }>(api, root, ME_TIMEZONE);
    expect(rootData.me.currentOrg?.timezone).toBe("Asia/Taipei");
  });

  describe("預設值:讀不到 / 改不動就不填、送出照 rules 驗", () => {
    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "defaults_guarded",
        definitionOf([
          field("title", "text"),
          // 受保護的固定值:沒有 show 的人讀不到
          field("secret", "number", {
            valueSource: { kind: "constant", value: 10 },
            permission: { show: true, edit: false },
          }),
          field("doubled", "number", {
            default: {
              kind: "expression",
              expr: { "*": [{ var: "secret" }, 2] },
            },
          }),
          // 限定可改:沒有 edit-… 的人改不動
          field("locked", "text", {
            permission: { show: false, edit: true },
            default: { kind: "constant", value: "預設" },
          }),
          field("code", "text", {
            rules: { maxLength: 2 },
            default: { kind: "constant", value: "ABCDEF" },
          }),
        ]),
      );
      await assignForm(api, root, "defaults_guarded", [tenant]);
    }, HOOK_TIMEOUT_MS);

    it("公式引用讀不到的受保護欄位 → 留空;有 show 的人算得出來", async () => {
      const draft = await createDraft(api, staff.token, "defaults_guarded", {
        title: "x",
      });
      expect(draft.values.doubled ?? null).toBeNull();

      const reader = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [
          M.view,
          M.create,
          M.edit,
          showKey("defaults_guarded", "secret"),
        ],
      });
      const readable = await createDraft(
        api,
        reader.token,
        "defaults_guarded",
        { title: "y" },
      );
      expect(readable.values.doubled).toBe("20");
    });

    it("沒有欄位級 edit 權限的欄位不填預設值;有 edit-… 的人照填", async () => {
      const draft = await createDraft(api, staff.token, "defaults_guarded", {
        title: "x",
      });
      expect(draft.values.locked ?? null).toBeNull();
      const editor = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [
          M.view,
          M.create,
          M.edit,
          editKey("defaults_guarded", "locked"),
        ],
      });
      const filled = await createDraft(api, editor.token, "defaults_guarded", {
        title: "y",
      });
      expect(filled.values.locked).toBe("預設");
    });

    it("預設值違反 rules:草稿照存、送出被擋(當一般欄位驗)", async () => {
      const draft = await createDraft(api, staff.token, "defaults_guarded", {
        title: "x",
      });
      expect(draft.values.code).toBe("ABCDEF");
      const blocked = await call(api, staff.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(codeOf(blocked)).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(extensionsOf(blocked))).toContain("MAX_LENGTH");
    });
  });

  describe("預設值(建草稿時由後端算)", () => {
    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "defaults_form",
        definitionOf([
          field("title", "text", {
            default: { kind: "constant", value: "採購單" },
          }),
          field("qty", "number", { default: { kind: "constant", value: 2 } }),
          field("price", "number"),
          field("budget", "number", {
            default: {
              kind: "expression",
              expr: { "*": [{ var: "qty" }, { var: "price" }] },
            },
          }),
          field("kind", "select", {
            default: { kind: "constant", value: "annual" },
          }),
          field("applicant", "reference", {
            source: { provider: "user", labelField: "name" },
            default: { kind: "expression", expr: { var: "ctx.user.id" } },
          }),
        ]),
      );
      await assignForm(api, root, "defaults_form", [tenant]);
    }, HOOK_TIMEOUT_MS);

    it("常數 / 公式 / 系統值填寫者寫進 values;送來的值不覆蓋;碰過的欄位不填", async () => {
      const draft = await createDraft(api, staff.token, "defaults_form", {
        price: "5",
      });
      expect(draft.values).toMatchObject({
        title: "採購單",
        qty: "2",
        price: "5",
        budget: "10",
        kind: "annual",
        applicant: { id: String(staff.userId) },
      });
      expect(
        (draft.values.applicant as { label: string | null }).label,
      ).toEqual(expect.any(String));
      expect(draft.touched).toEqual([]);

      const touched = await ok<{
        createFormDraft: { submission: SubmissionRow };
      }>(api, staff.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: "defaults_form",
          clientRequestId: randomUUID(),
          values: { title: "自己打的", qty: null },
          touched: ["qty", "not_a_field"],
        },
      });
      const created = touched.createFormDraft.submission;
      expect(created.values.title).toBe("自己打的");
      // 碰過(清空)的欄位不填預設值;公式照目前的值算不出來 → 留空
      expect(created.values.qty).toBeNull();
      expect(created.values.budget).toBeNull();
      // 不存在的 key 不存
      expect(created.touched).toEqual(["qty"]);
    });

    it("存草稿一併存 touched[](缺席 = 保留);送出照一般欄位驗證", async () => {
      const draft = await createDraft(api, staff.token, "defaults_form", {});
      const saved = await ok<{
        saveFormDraft: { submission: SubmissionRow };
      }>(api, staff.token, SAVE_FORM_DRAFT, {
        input: {
          id: draft.id,
          expectedEditVersion: draft.editVersion,
          values: { ...draft.values, title: "改過" },
          touched: ["title"],
        },
      });
      expect(saved.saveFormDraft.submission.touched).toEqual(["title"]);
      const again = await ok<{
        saveFormDraft: { submission: SubmissionRow };
      }>(api, staff.token, SAVE_FORM_DRAFT, {
        input: {
          id: draft.id,
          expectedEditVersion: saved.saveFormDraft.submission.editVersion,
          values: saved.saveFormDraft.submission.values,
        },
      });
      expect(again.saveFormDraft.submission.touched).toEqual(["title"]);
      const raw = await rawSubmission(connection, draft.id);
      expect(raw?.touched).toEqual(["title"]);
      const submitted = await submitDraft(
        api,
        staff.token,
        again.saveFormDraft.submission,
      );
      expect(submitted.status).toBe("COMPLETED");
      expect(submitted.values).toMatchObject({ title: "改過", qty: "2" });
    });
  });

  describe("datetime", () => {
    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "datetime_form",
        definitionOf(
          [
            field("title", "text"),
            field("start_at", "datetime", {
              rules: { min: "2026-01-01T00:00:00Z" },
            }),
            field("end_at", "datetime"),
            field("hours", "number", {
              precision: 1,
              valueSource: {
                kind: "computed",
                expr: {
                  dateDiff: [{ var: "start_at" }, { var: "end_at" }, "hours"],
                },
              },
            }),
          ],
          { summaryMap: { title: "title", date: "start_at" } },
        ),
      );
      await assignForm(api, root, "datetime_form", [tenant]);
    }, HOOK_TIMEOUT_MS);

    it("存 Mongo Date(GraphQL 回 ISO)、上下限、dateDiff 小時、摘要槽日期對日期時間欄;修訂 ctx 記租戶時區", async () => {
      const draft = await createDraft(api, staff.token, "datetime_form", {
        title: "出差",
        start_at: "2026-03-01T09:00+09:00",
        end_at: "2026-03-01T11:30:00+09:00",
      });
      expect(draft.values).toMatchObject({
        start_at: "2026-03-01T00:00:00.000Z",
        end_at: "2026-03-01T02:30:00.000Z",
        hours: "2.5",
      });
      const raw = await rawSubmission(connection, draft.id);
      expect((raw?.values as Record<string, unknown>).start_at).toEqual(
        new Date("2026-03-01T00:00:00Z"),
      );
      const submitted = await submitDraft(api, staff.token, draft);
      expect(submitted.summary?.date).toBe("2026-03-01T00:00:00.000Z");
      expect(submitted.ctx?.timezone).toBe("Asia/Tokyo");

      const noZone = await call(api, staff.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: "datetime_form",
          clientRequestId: randomUUID(),
          values: { title: "x", start_at: "2026-03-01T09:00" },
        },
      });
      expect(codeOf(noZone)).toBe("VALIDATION_FAILED");

      const early = await createDraft(api, staff.token, "datetime_form", {
        title: "太早",
        start_at: "2025-12-31T23:00:00Z",
      });
      const blocked = await call(
        api,
        staff.token,
        /* GraphQL */ `
          mutation Submit($input: SubmitFormSubmissionInput!) {
            submitFormSubmission(input: $input) {
              submission {
                id
              }
            }
          }
        `,
        { input: { id: early.id, expectedEditVersion: early.editVersion } },
      );
      expect(codeOf(blocked)).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(extensionsOf(blocked))).toContain('"MIN"');
    });
  });

  describe("date / datetime 存 Mongo Date", () => {
    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "temporal_form",
        definitionOf(
          [
            field("title", "text"),
            field("day", "date"),
            field("meeting", "datetime"),
            // 預設值是固定日期(版本定義裡是 ISO):以租戶時區(東京)收斂成當地 00:00
            field("due", "date", {
              default: { kind: "constant", value: "2026-09-30T00:00:00+08:00" },
            }),
            field("next_day", "date", {
              valueSource: {
                kind: "computed",
                expr: { var: "meeting" },
              },
            }),
          ],
          { summaryMap: { title: "title", date: "day" } },
        ),
      );
      await assignForm(api, root, "temporal_form", [tenant]);
    }, HOOK_TIMEOUT_MS);

    it("存進去是 Date(date 收斂成租戶時區當地 00:00),GraphQL 讀回 ISO;摘要槽、修訂快照都是 Date", async () => {
      // 東京選 09-26 → 當地 00:00 = 2026-09-25T15:00Z;送的時點不是午夜也收斂回當天 00:00
      const draft = await createDraft(api, staff.token, "temporal_form", {
        title: "會議",
        day: "2026-09-26T10:30:00+09:00",
        meeting: "2026-09-26T14:30+09:00",
      });
      expect(draft.values).toMatchObject({
        day: "2026-09-25T15:00:00.000Z",
        meeting: "2026-09-26T05:30:00.000Z",
        next_day: "2026-09-25T15:00:00.000Z",
        // 台北 9/30 00:00 = 東京 9/30 01:00 → 東京 9/30 00:00
        due: "2026-09-29T15:00:00.000Z",
      });
      const rawDraft = await rawSubmission(connection, draft.id);
      const draftValues = rawDraft?.values as Record<string, unknown>;
      expect(draftValues.day).toBeInstanceOf(Date);
      expect(draftValues.meeting).toBeInstanceOf(Date);
      expect(draftValues.next_day).toBeInstanceOf(Date);
      expect(draftValues.due).toEqual(new Date("2026-09-29T15:00:00.000Z"));

      const submitted = await submitDraft(api, staff.token, draft);
      expect(submitted.summary?.date).toBe("2026-09-25T15:00:00.000Z");
      const raw = await rawSubmission(connection, draft.id);
      expect((raw?.summary as Record<string, unknown>).date).toEqual(
        new Date("2026-09-25T15:00:00.000Z"),
      );
      const [snapshot] = raw?.revisions as {
        values: Record<string, unknown>;
      }[];
      expect(snapshot?.values.day).toEqual(
        new Date("2026-09-25T15:00:00.000Z"),
      );

      // 已完成修改:同值(ISO 送回)不算改動;改日期後新快照也是 Date,舊快照不動
      const updated = await ok<{
        updateFormSubmission: { submission: SubmissionRow };
      }>(api, staff.token, UPDATE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: submitted.editVersion,
          expectedRevision: submitted.revision,
          values: { ...submitted.values, day: "2026-09-27T00:00:00+09:00" },
        },
      });
      expect(updated.updateFormSubmission.submission.values).toMatchObject({
        day: "2026-09-26T15:00:00.000Z",
      });
      const revised = await rawSubmission(connection, draft.id);
      const revisions = revised?.revisions as {
        values: Record<string, unknown>;
      }[];
      expect(revisions.map((entry) => entry.values.day)).toEqual([
        new Date("2026-09-25T15:00:00.000Z"),
        new Date("2026-09-26T15:00:00.000Z"),
      ]);
      expect(revisions[1]?.values.meeting).toBeInstanceOf(Date);
    });

    it("lookup form_submission 來源:日期時間當顯示欄,以讀者的租戶時區印", async () => {
      await publishNewForm(
        api,
        root,
        "temporal_ref",
        definitionOf([
          field("title", "text"),
          field("pick", "reference", {
            source: {
              provider: "form_submission",
              formKey: "temporal_form",
              labelField: "meeting",
            },
          }),
        ]),
      );
      await assignForm(api, root, "temporal_ref", [tenant]);
      await createSubmitted(api, staff.token, "temporal_form", {
        title: "查得到",
        day: "2026-10-01T00:00:00+09:00",
        meeting: "2026-10-01T09:15:00+09:00",
      });
      const data = await ok<{
        formLookup: {
          items: { label: string | null; values: Record<string, unknown> }[];
        };
      }>(api, staff.token, FORM_LOOKUP, {
        input: {
          formKey: "temporal_ref",
          version: 1,
          target: { fieldKey: "pick" },
          keyword: "查得到",
        },
      });
      // 存的是 Date(00:15Z);顯示名 = 東京時區的 YYYY-MM-DD HH:mm
      expect(data.formLookup.items.map((item) => item.label)).toEqual([
        "2026-10-01 09:15",
      ]);
    });

    it("只有日期、沒有時區的字串拒收(VALIDATION_FAILED)", async () => {
      for (const day of ["2026-09-26", "2026-09-26T10:00"]) {
        const result = await call(api, staff.token, CREATE_FORM_DRAFT, {
          input: {
            formKey: "temporal_form",
            clientRequestId: randomUUID(),
            values: { title: "x", day },
          },
        });
        expect(codeOf(result)).toBe("VALIDATION_FAILED");
      }
    });
  });

  describe("上傳欄的檔型 / 大小上限", () => {
    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        "upload_limit_form",
        definitionOf([
          field("title", "text"),
          field("proof", "upload", {
            rules: { accept: ["application/pdf"], maxSizeMb: 1 },
          }),
        ]),
      );
      await assignForm(api, root, "upload_limit_form", [tenant]);
    }, HOOK_TIMEOUT_MS);

    it("平台清單與 domain 常數一致", () => {
      const rule = UPLOAD_RULES[UploadPurpose.FORM_ATTACHMENT];
      expect(new Set(Object.keys(rule.extensions))).toEqual(
        new Set(FORM_UPLOAD_CONTENT_TYPES),
      );
      expect(rule.maxBytes).toBe(MAX_ATTACHMENT_UPLOAD_BYTES);
      expect(MAX_ATTACHMENT_UPLOAD_BYTES).toBe(
        FORM_UPLOAD_MAX_SIZE_MB * 1024 * 1024,
      );
    });

    it("偽造 contentType(路徑是 .png、宣稱 application/pdf)→ UPLOAD_INVALID", async () => {
      const forged = {
        ...uploadOf("application/pdf", 1000, "png"),
      };
      const rejected = await call(api, staff.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: "upload_limit_form",
          clientRequestId: randomUUID(),
          values: { title: "偽造", proof: forged },
        },
      });
      expect(codeOf(rejected)).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(extensionsOf(rejected))).toContain(
        "UPLOAD_INVALID",
      );
    });

    it("存草稿與送出都照欄位設定擋:檔型不符、超過大小 → UPLOAD_INVALID;符合的照存", async () => {
      for (const proof of [
        uploadOf("image/png", 1000, "png"),
        uploadOf("application/pdf", 2 * 1024 * 1024, "pdf"),
      ]) {
        const rejected = await call(api, staff.token, CREATE_FORM_DRAFT, {
          input: {
            formKey: "upload_limit_form",
            clientRequestId: randomUUID(),
            values: { title: "附件", proof },
          },
        });
        expect(codeOf(rejected)).toBe("VALIDATION_FAILED");
        expect(JSON.stringify(extensionsOf(rejected))).toContain(
          "UPLOAD_INVALID",
        );
      }
      const accepted = await createDraft(
        api,
        staff.token,
        "upload_limit_form",
        {
          title: "附件",
          proof: uploadOf("application/pdf", 500_000, "pdf"),
        },
      );
      expect(await submitDraft(api, staff.token, accepted)).toMatchObject({
        status: "COMPLETED",
      });
    });
  });

  describe("型別檢查接進檢查器", () => {
    it("存草稿允許(錯誤隨 validation 回)、發布擋下(DEFINITION_INVALID)", async () => {
      await ok(api, root, CREATE_FORM, {
        input: { key: "typed_form", moduleKey: "demo-form", name: "型別" },
      });
      const draft = await ok<{
        createFormVersionDraft: { formVersion: VersionRow };
      }>(api, root, CREATE_DRAFT, { input: { formKey: "typed_form" } });
      const saved = await ok<{
        saveFormVersionDraft: {
          formVersion: VersionRow;
          validation: { errors: { code: string }[] };
        };
      }>(
        api,
        root,
        /* GraphQL */ `
          mutation Save($input: SaveFormVersionDraftInput!) {
            saveFormVersionDraft(input: $input) {
              formVersion {
                draftRevision
              }
              validation {
                errors {
                  code
                }
              }
            }
          }
        `,
        {
          input: {
            formKey: "typed_form",
            expectedDraftRevision:
              draft.createFormVersionDraft.formVersion.draftRevision,
            ...definitionOf([
              field("title", "text"),
              field("qty", "number", {
                visibleWhen: { var: "title" },
              }),
            ]),
          },
        },
      );
      expect(
        saved.saveFormVersionDraft.validation.errors.map((issue) => issue.code),
      ).toEqual(["EXPR_TYPE_MISMATCH"]);
      const published = await call(api, root, PUBLISH, {
        input: {
          formKey: "typed_form",
          expectedDraftRevision:
            saved.saveFormVersionDraft.formVersion.draftRevision,
          changelog: "x",
        },
      });
      expect(codeOf(published)).toBe("VALIDATION_FAILED");
    });
  });

  describe("刪除表單草稿", () => {
    it("刪掉後可再開新草稿;revision 不符 409;稽核 form-version.delete-draft", async () => {
      await publishNewForm(
        api,
        root,
        "delete_draft_form",
        definitionOf([field("title", "text")]),
      );
      const draft = await ok<{
        createFormVersionDraft: { formVersion: VersionRow };
      }>(api, root, CREATE_DRAFT, {
        input: { formKey: "delete_draft_form", baseVersion: 1 },
      });
      const { id, draftRevision } = draft.createFormVersionDraft.formVersion;
      const stale = await call(api, root, DELETE_VERSION_DRAFT, {
        input: {
          formKey: "delete_draft_form",
          expectedDraftRevision: draftRevision + 1,
        },
      });
      expect(codeOf(stale)).toBe("CONFLICT");
      expect(extensionsOf(stale).reason).toBe("DRAFT_REVISION_MISMATCH");

      const deleted = await ok<{
        deleteFormVersionDraft: { form: { hasDraft: boolean } };
      }>(api, root, DELETE_VERSION_DRAFT, {
        input: {
          formKey: "delete_draft_form",
          expectedDraftRevision: draftRevision,
        },
      });
      expect(deleted.deleteFormVersionDraft.form.hasDraft).toBe(false);
      const versions = await ok<{ formVersions: { items: VersionRow[] } }>(
        api,
        root,
        FORM_VERSIONS,
        { formKey: "delete_draft_form" },
      );
      expect(versions.formVersions.items.map((item) => item.status)).toEqual([
        "PUBLISHED",
      ]);
      expect(
        await connection
          .collection("form_versions")
          .countDocuments({ _id: new Types.ObjectId(id) }),
      ).toBe(0);
      const audit = await connection.collection("audit_logs").findOne({
        action: "form-version.delete-draft",
        targetId: new Types.ObjectId(id),
      });
      expect(audit?.before).toMatchObject({
        formKey: "delete_draft_form",
        draftRevision,
        baseVersion: 1,
        fields: [expect.objectContaining({ key: "title" })],
        summaryMap: { title: "title" },
      });
      // 刪掉後再刪 → 沒有草稿
      const missing = await call(api, root, DELETE_VERSION_DRAFT, {
        input: {
          formKey: "delete_draft_form",
          expectedDraftRevision: draftRevision,
        },
      });
      expect(extensionsOf(missing).reason).toBe("DRAFT_MISSING");
      // 可以再開新草稿
      await ok(api, root, CREATE_DRAFT, {
        input: { formKey: "delete_draft_form", baseVersion: 1 },
      });
    });

    it("發布中(發布中斷)不可刪:409 PUBLISH_IN_PROGRESS", async () => {
      await publishNewForm(
        api,
        root,
        "delete_publishing",
        definitionOf([field("title", "text")]),
      );
      const draft = await ok<{
        createFormVersionDraft: { formVersion: VersionRow };
      }>(api, root, CREATE_DRAFT, {
        input: { formKey: "delete_publishing", baseVersion: 1 },
      });
      const saved = await saveDefinition(
        api,
        root,
        "delete_publishing",
        definitionOf([field("title", "text"), field("note", "text")]),
        draft.createFormVersionDraft.formVersion.draftRevision,
      );
      // 發布是一個交易,不會再中斷;模擬交易之前留下的中斷資料
      await simulateInterruptedPublish(
        api.connection,
        "delete_publishing",
        "publishing",
        "中斷",
      );
      const blocked = await call(api, root, DELETE_VERSION_DRAFT, {
        input: {
          formKey: "delete_publishing",
          expectedDraftRevision: saved.draftRevision,
        },
      });
      expect(codeOf(blocked)).toBe("CONFLICT");
      expect(extensionsOf(blocked).reason).toBe("PUBLISH_IN_PROGRESS");
    });

    it("沒有 system.forms.edit 的人不能刪", async () => {
      const denied = await call(api, staff.token, DELETE_VERSION_DRAFT, {
        input: { formKey: "delete_draft_form", expectedDraftRevision: 0 },
      });
      expect(codeOf(denied)).toBe("FORBIDDEN");
    });
  });
});
