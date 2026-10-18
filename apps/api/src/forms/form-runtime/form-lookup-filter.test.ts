import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
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
  ok,
  publishNewForm,
  rootToken,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface FieldError {
  fieldKey: string;
  rowId?: string;
  columnKey?: string;
  code: string;
}

interface LookupData {
  formLookup: {
    items: {
      id: string;
      label: string | null;
      values: Record<string, unknown>;
    }[];
    totalCount: number;
  };
}

/**
 * 連動篩選與列內帶入:篩選值引用表單層欄位 `{ var }`(這裡用 `user` 來源的
 * `enabled` ← 表單的是否欄位「只列啟用中的」);前端查詢送目前值、伺服器只當縮小範圍;送出以最後的值再驗
 * → `LOOKUP_FILTER_MISMATCH`。明細引用子欄的帶入規則讓 `formLookup` 回對應的來源欄位。
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("連動篩選:查詢縮小範圍 / 送出再驗 / 檢查器;列內帶入的來源欄位", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let staff: FormOperator;
  let active: Types.ObjectId;
  let retired: Types.ObjectId;

  const FORM = "linked_lookups";
  const linkedUser = {
    provider: "user",
    labelField: "name",
    filter: { enabled: { var: "active_only" } },
  };
  const fields: FieldDef[] = [
    field("title", "text"),
    field("active_only", "boolean", { widget: { kind: "checkbox" } }),
    field("owner", "reference", { source: linkedUser }),
    field("lines", "array", {
      columns: [
        column("who", "reference", {
          source: linkedUser,
          prefill: { mapping: [{ sourceField: "name", fieldKey: "note" }] },
        }),
        column("note", "text"),
      ],
    }),
  ];

  async function insertUser(
    orgId: Types.ObjectId,
    name: string,
    enabled: boolean,
  ): Promise<Types.ObjectId> {
    const now = new Date();
    const _id = new Types.ObjectId();
    await connection.collection("users").insertOne({
      _id,
      name,
      account: name,
      email: `${name}@example.com`,
      passwordHash: "unused",
      enabled,
      settings: {},
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
    await connection.collection("core_relationships").insertOne({
      type: "org_user",
      firstId: orgId,
      secondId: _id,
      thirdId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
    return _id;
  }

  const ref = (id: Types.ObjectId) => ({ id: String(id), label: "前端給的" });

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-lookup-filter");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "連動篩選租戶" });
    active = await insertUser(tenant, "linked_active", true);
    retired = await insertUser(tenant, "linked_retired", false);
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

  const lookup = async (
    fieldKey: string,
    filterValues?: Record<string, unknown>,
  ): Promise<LookupData["formLookup"]> => {
    const data = await ok<LookupData>(api, staff.token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey },
        keyword: "linked_",
        ...(filterValues !== undefined && { filterValues }),
      },
    });
    return data.formLookup;
  };

  it("formLookup 以前端送的目前值縮小範圍;沒送被引用欄位的值 → 查無", async () => {
    const onlyActive = await lookup("owner", { active_only: true });
    expect(onlyActive.items).toEqual([
      expect.objectContaining({ id: String(active) }),
    ]);
    const onlyRetired = await lookup("owner", { active_only: false });
    expect(onlyRetired.items).toEqual([
      expect.objectContaining({ id: String(retired) }),
    ]);
    const missing = await lookup("owner");
    expect(missing.totalCount).toBe(0);
    // 不是純量的值當沒填(不能拿物件塞查詢條件)
    const injected = await lookup("owner", { active_only: { $ne: true } });
    expect(injected.totalCount).toBe(0);
    // 型別不符(是否欄送字串)當沒填:查無,不是 500(CastError)
    const mistyped = await lookup("owner", { active_only: "abc" });
    expect(mistyped.totalCount).toBe(0);
    const mistypedRow = await lookup("lines.who", { active_only: "true" });
    expect(mistypedRow.totalCount).toBe(0);
  });

  it("明細引用子欄:同樣縮小範圍,且回列內帶入要的來源欄位", async () => {
    const page = await lookup("lines.who", { active_only: true });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: String(active),
        values: { name: "linked_active" },
      }),
    ]);
  });

  it("送出時以最後的值再驗:竄改送不屬於篩選的 id → VALIDATION_FAILED + LOOKUP_FILTER_MISMATCH", async () => {
    const rowId = randomUUID();
    const draft = await createDraft(api, staff.token, FORM, {
      title: "竄改",
      active_only: true,
      owner: ref(retired),
      lines: [{ rowId, who: ref(retired), note: "x" }],
    });
    const result = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    const errors = extensionsOf(result).fieldErrors as FieldError[];
    expect(
      errors.map((issue) => [
        issue.fieldKey,
        issue.rowId,
        issue.columnKey,
        issue.code,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["owner", undefined, undefined, "LOOKUP_FILTER_MISMATCH"],
        ["lines", rowId, "who", "LOOKUP_FILTER_MISMATCH"],
      ]),
    );
  });

  it("被引用欄位沒有值 → 讀得到的引用一律算不符;讀不到的仍是 SOURCE_UNAVAILABLE", async () => {
    const outsider = await insertUser(
      await createOrg(connection, { name: "別的租戶" }),
      "linked_outsider",
      true,
    );
    const draft = await createDraft(api, staff.token, FORM, {
      title: "沒填篩選",
      owner: ref(active),
      lines: [{ rowId: randomUUID(), who: ref(outsider) }],
    });
    const result = await call(api, staff.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    const errors = extensionsOf(result).fieldErrors as FieldError[];
    expect(errors.map((issue) => [issue.fieldKey, issue.code])).toEqual(
      expect.arrayContaining([
        ["owner", "LOOKUP_FILTER_MISMATCH"],
        ["lines", "SOURCE_UNAVAILABLE"],
      ]),
    );
  });

  it("符合篩選 → 送出成功;之後只改被引用欄位、引用沿用舊值 → 用最後的值重驗而擋下", async () => {
    const submitted = await createSubmitted(api, staff.token, FORM, {
      title: "正常",
      active_only: true,
      owner: ref(active),
      lines: [{ rowId: randomUUID(), who: ref(active), note: "手動改過" }],
    });
    expect(submitted.values.owner).toEqual({
      id: String(active),
      label: "linked_active",
    });
    // 伺服器不強制帶入:手動改過的子欄照存
    expect((submitted.values.lines as Record<string, unknown>[])[0]?.note).toBe(
      "手動改過",
    );
    const result = await call(api, staff.token, UPDATE_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: submitted.editVersion,
        expectedRevision: submitted.revision,
        values: { ...submitted.values, active_only: false },
      },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(
      (extensionsOf(result).fieldErrors as FieldError[]).map(
        (issue) => issue.code,
      ),
    ).toEqual(["LOOKUP_FILTER_MISMATCH", "LOOKUP_FILTER_MISMATCH"]);
  });

  it("檢查器:引用型別不符 / 同一列子欄 / 不能篩選的欄位 / 帶入型別不符,定位到欄位或子欄", async () => {
    const report = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: FORM,
        ...definitionOf([
          field("title", "text"),
          field("owner", "reference", {
            source: {
              provider: "user",
              labelField: "name",
              filter: { enabled: { var: "title" } },
            },
          }),
          field("lines", "array", {
            columns: [
              column("flag", "boolean", { widget: { kind: "checkbox" } }),
              column("who", "reference", {
                source: {
                  provider: "user",
                  labelField: "name",
                  filter: { enabled: { var: "flag" } },
                },
                prefill: {
                  mapping: [{ sourceField: "name", fieldKey: "qty" }],
                },
              }),
              column("qty", "number"),
            ],
          }),
          field("org", "reference", {
            source: {
              provider: "org",
              labelField: "name",
              filter: { slug: { var: "title" } },
            },
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
        ["LOOKUP_FILTER_VAR_TYPE", "owner", undefined],
        ["LOOKUP_FILTER_VAR_INVALID", "lines", "who"],
        ["PREFILL_TYPE_INCOMPATIBLE", "lines", "who"],
        ["LOOKUP_FILTER_VAR_INVALID", "org", undefined],
      ]),
    );
  });
});
