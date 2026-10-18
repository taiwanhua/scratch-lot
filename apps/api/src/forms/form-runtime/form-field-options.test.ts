import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_DRAFT,
  F,
  FORK_FORM,
  FORMS_MODULES,
  FORM_LOOKUP,
  FORM_LOOKUP_RECORD,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  RETIRE_CURRENT,
  REVOKE,
  SET_TENANT_ENABLED,
  assignForm,
  call,
  codeOf,
  createOperator,
  createSubmitted,
  definitionOf,
  field,
  getForm,
  ok,
  publishDraft,
  publishNewForm,
  rootToken,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM_FIELD_OPTIONS = /* GraphQL */ `
  query FormFieldOptions($input: FormFieldOptionsInput!) {
    formFieldOptions(input: $input) {
      items {
        value
        label
      }
      totalCount
      page
      pageSize
    }
  }
`;

const FORM_RUNTIME_VERSION = /* GraphQL */ `
  query FormRuntimeVersion($formKey: ID!, $version: Int!) {
    formRuntimeVersion(formKey: $formKey, version: $version) {
      formVersion {
        version
        fields
      }
    }
  }
`;

interface OptionsPayload {
  formFieldOptions: {
    items: { value: string; label: string }[];
    totalCount: number;
    page: number;
    pageSize: number;
  };
}

interface RuntimeVersionPayload {
  formRuntimeVersion: { formVersion: { version: number; fields: FieldDef[] } };
}

const FORM = "options_form";
const CUSTOM_FORM = "options_form_custom";
const CATEGORY = "demo-category";

/** 只有一個必填類別選項欄的表單(版本 / 表單狀態的情境共用)。 */
const categoryForm = () =>
  definitionOf([
    field("title", "text"),
    field("kind", "select", {
      options: { kind: "fieldCategory", key: CATEGORY },
      rules: { required: true },
    }),
  ]);

/** GraphQL 結果的錯誤(避免在 await 運算式上直接取成員)。 */
const errorsOf = (result: { errors?: unknown }): unknown => result.errors;

/**
 * 填寫端的類別選項與定義投影:
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("formFieldOptions 與 formRuntimeVersion 的讀者投影", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let otherTenant: Types.ObjectId;
  /** 一般員工:模組 view / create / edit,沒有欄位管理的權限、沒有任何 show。 */
  let staff: FormOperator;
  let manager: FormOperator;

  const optionsOf = (
    token: string,
    input: Record<string, unknown>,
  ): ReturnType<typeof call<OptionsPayload>> =>
    call<OptionsPayload>(api, token, FORM_FIELD_OPTIONS, { input });

  const runtimeFieldsOf = async (token: string): Promise<FieldDef[]> => {
    const data = await ok<RuntimeVersionPayload>(
      api,
      token,
      FORM_RUNTIME_VERSION,
      { formKey: FORM, version: 1 },
    );
    return data.formRuntimeVersion.formVersion.fields;
  };

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-field-options");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "選項的租戶" });
    otherTenant = await createOrg(connection, { name: "別的租戶" });
    await publishNewForm(
      api,
      root,
      FORM,
      definitionOf([
        field("title", "text"),
        field("kind", "select", {
          options: { kind: "fieldCategory", key: CATEGORY },
          rules: { required: true },
          help: "公開欄位的說明",
        }),
        field("secret_kind", "select", {
          options: { kind: "fieldCategory", key: CATEGORY },
          permission: { show: true, edit: false },
        }),
        field("level", "select", {
          permission: { show: true, edit: false },
          help: "只有主管看得到的等級說明",
        }),
        field("qty", "number"),
        field("price", "number", {
          valueSource: { kind: "constant", value: 4321 },
          permission: { show: true, edit: false },
          help: "內部單價",
        }),
        field("total", "number", {
          valueSource: {
            kind: "computed",
            expr: { "*": [{ var: "qty" }, { var: "price" }] },
          },
        }),
        field("total_tax", "number", {
          valueSource: {
            kind: "computed",
            expr: { "*": [{ var: "total" }, 1.05] },
          },
        }),
      ]),
    );
    await assignForm(api, root, FORM, [tenant]);
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
    manager = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [
        M.view,
        M.create,
        M.edit,
        showKey(FORM, "secret_kind"),
        showKey(FORM, "level"),
        showKey(FORM, "price"),
      ],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("formFieldOptions", () => {
    it("一般員工(無欄位管理權限)取得合併範圍的啟用選項,並能送出必填的類別欄", async () => {
      const all = await optionsOf(staff.token, {
        formKey: FORM,
        version: 1,
        fieldKey: "kind",
      });
      expect(all.errors).toBeUndefined();
      const payload = all.data?.formFieldOptions;
      expect(payload?.items).toContainEqual({ value: "drink", label: "飲品" });
      expect(payload?.totalCount).toBe(payload?.items.length);
      expect(payload?.page).toBe(1);

      const filtered = await optionsOf(staff.token, {
        formKey: FORM,
        version: 1,
        fieldKey: "kind",
        keyword: "飲",
      });
      expect(filtered.data?.formFieldOptions.items).toEqual([
        { value: "drink", label: "飲品" },
      ]);

      const paged = await optionsOf(staff.token, {
        formKey: FORM,
        version: 1,
        fieldKey: "kind",
        page: 2,
        pageSize: 1,
      });
      expect(paged.data?.formFieldOptions.items).toEqual([payload?.items[1]]);

      const submitted = await createSubmitted(api, staff.token, FORM, {
        title: "用選項送出",
        kind: { value: "drink", label: "飲品" },
      });
      expect(submitted.status).toBe("COMPLETED");
      expect(submitted.values.kind).toEqual({ value: "drink", label: "飲品" });
    });

    it("只有模組 view 也取得到;沒有模組權限 → FORBIDDEN", async () => {
      const viewer = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.view],
      });
      const viewed = await optionsOf(viewer.token, {
        formKey: FORM,
        version: 1,
        fieldKey: "kind",
      });
      expect(viewed.errors).toBeUndefined();

      const stranger = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [],
      });
      const denied = await optionsOf(stranger.token, {
        formKey: FORM,
        version: 1,
        fieldKey: "kind",
      });
      expect(codeOf(denied)).toBe("FORBIDDEN");
    });

    it("表單 / 版本不存在 → NOT_FOUND;欄位不是類別選項 → VALIDATION_FAILED", async () => {
      expect(
        codeOf(
          await optionsOf(staff.token, {
            formKey: "no_such_form",
            version: 1,
            fieldKey: "kind",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        codeOf(
          await optionsOf(staff.token, {
            formKey: FORM,
            version: 99,
            fieldKey: "kind",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        codeOf(
          await optionsOf(staff.token, {
            formKey: FORM,
            version: 1,
            fieldKey: "title",
          }),
        ),
      ).toBe("VALIDATION_FAILED");
    });

    it("受保護的類別欄:沒有 show → FORBIDDEN;有 show → 照回", async () => {
      const input = { formKey: FORM, version: 1, fieldKey: "secret_kind" };
      expect(codeOf(await optionsOf(staff.token, input))).toBe("FORBIDDEN");
      const allowed = await optionsOf(manager.token, input);
      expect(allowed.errors).toBeUndefined();
      expect(allowed.data?.formFieldOptions.items).toContainEqual({
        value: "drink",
        label: "飲品",
      });
    });

    it("別租戶的客製表單 → NOT_FOUND;擁有它的租戶取得到", async () => {
      const designer = await createOperator(api, connection, {
        orgId: tenant,
        moduleKeys: ["system", "system.forms", MODULE_KEY],
        permissionKeys: ["system.forms.*", M.view, M.create, M.edit],
      });
      await ok(api, designer.token, FORK_FORM, {
        input: {
          sourceKey: FORM,
          sourceVersion: 1,
          key: CUSTOM_FORM,
          name: "客製選項表單",
        },
      });
      await publishDraft(
        api,
        designer.token,
        CUSTOM_FORM,
        definitionOf([
          field("title", "text"),
          field("kind", "select", {
            options: { kind: "fieldCategory", key: CATEGORY },
          }),
        ]),
        0,
      );
      const input = { formKey: CUSTOM_FORM, version: 1, fieldKey: "kind" };
      const own = await optionsOf(staff.token, input);
      expect(own.errors).toBeUndefined();

      const outsider = await createOperator(api, connection, {
        orgId: otherTenant,
        permissionKeys: [M.view, M.create, M.edit],
      });
      expect(codeOf(await optionsOf(outsider.token, input))).toBe("NOT_FOUND");
    });
  });

  describe("formFieldOptions:版本與表單狀態", () => {
    const LIFECYCLE = "options_lifecycle";
    const PREVIEW = "options_preview";

    it("租戶停用、root 收回分派、退役目前版本之後,既有的單仍取得到選項", async () => {
      await publishNewForm(api, root, LIFECYCLE, categoryForm());
      await assignForm(api, root, LIFECYCLE, [tenant]);
      const input = { formKey: LIFECYCLE, version: 1, fieldKey: "kind" };
      const tenantAdmin = await createOperator(api, connection, {
        orgId: tenant,
        moduleKeys: [...FORMS_MODULES, MODULE_KEY],
        permissionKeys: [F.all, M.all],
      });

      await ok(api, tenantAdmin.token, SET_TENANT_ENABLED, {
        input: { formKey: LIFECYCLE, enabled: false },
      });
      expect(errorsOf(await optionsOf(staff.token, input))).toBeUndefined();

      await ok(api, root, REVOKE, {
        input: { formKey: LIFECYCLE, tenantOrgId: String(tenant) },
      });
      expect(errorsOf(await optionsOf(staff.token, input))).toBeUndefined();

      const { currentVersion } = await getForm(api, root, LIFECYCLE);
      await ok(api, root, RETIRE_CURRENT, {
        input: { formKey: LIFECYCLE, expectedVersion: currentVersion },
      });
      const retired = await optionsOf(staff.token, input);
      expect(retired.errors).toBeUndefined();
      expect(retired.data?.formFieldOptions.items).toContainEqual({
        value: "drink",
        label: "飲品",
      });
    });

    it("version 省略 = 設計器預覽草稿:設計者取得到,沒有表單管理檢視權限的填寫者 → FORBIDDEN", async () => {
      await publishNewForm(api, root, PREVIEW, categoryForm());
      await assignForm(api, root, PREVIEW, [tenant]);
      await ok(api, root, CREATE_DRAFT, {
        input: { formKey: PREVIEW, baseVersion: 1 },
      });
      const input = { formKey: PREVIEW, fieldKey: "kind" };

      const designer = await optionsOf(root, input);
      expect(designer.errors).toBeUndefined();
      expect(designer.data?.formFieldOptions.items).toContainEqual({
        value: "drink",
        label: "飲品",
      });
      expect(codeOf(await optionsOf(staff.token, input))).toBe("FORBIDDEN");
    });

    it("讀不到的欄位:不論它是不是類別選項都回 FORBIDDEN(不從錯誤碼透露 options 的種類)", async () => {
      // level 是靜態選項、受保護:沒有 show 的人拿到 FORBIDDEN,不是 VALIDATION_FAILED
      expect(
        codeOf(
          await optionsOf(staff.token, {
            formKey: FORM,
            version: 1,
            fieldKey: "level",
          }),
        ),
      ).toBe("FORBIDDEN");
      // 有 show 的人才看得到「它不是類別選項」
      expect(
        codeOf(
          await optionsOf(manager.token, {
            formKey: FORM,
            version: 1,
            fieldKey: "level",
          }),
        ),
      ).toBe("VALIDATION_FAILED");
    });
  });

  describe("formLookup / formLookupRecord:受保護的選項欄與引用欄", () => {
    const LOOKUP_FORM = "options_lookup";

    beforeAll(async () => {
      await publishNewForm(
        api,
        root,
        LOOKUP_FORM,
        definitionOf([
          field("title", "text"),
          field("owner", "reference", {
            source: { provider: "user", labelField: "name" },
          }),
          field("secret_owner", "reference", {
            source: { provider: "user", labelField: "name" },
            permission: { show: true, edit: false },
          }),
          field("secret_pick", "select", {
            options: {
              kind: "lookup",
              source: { provider: "org", labelField: "name" },
            },
            permission: { show: true, edit: false },
          }),
        ]),
      );
      await assignForm(api, root, LOOKUP_FORM, [tenant]);
    }, HOOK_TIMEOUT_MS);

    const lookup = (token: string, fieldKey: string) =>
      call(api, token, FORM_LOOKUP, {
        input: { formKey: LOOKUP_FORM, version: 1, target: { fieldKey } },
      });

    it("沒有 show:引用欄 / lookup 選項欄都不給候選資料(FORBIDDEN),單筆取回也一樣", async () => {
      expect(codeOf(await lookup(staff.token, "secret_owner"))).toBe(
        "FORBIDDEN",
      );
      expect(codeOf(await lookup(staff.token, "secret_pick"))).toBe(
        "FORBIDDEN",
      );
      const record = await call(api, staff.token, FORM_LOOKUP_RECORD, {
        input: {
          formKey: LOOKUP_FORM,
          version: 1,
          target: { fieldKey: "secret_owner" },
          id: String(staff.userId),
        },
      });
      expect(codeOf(record)).toBe("FORBIDDEN");
      // 公開的引用欄照常
      expect(errorsOf(await lookup(staff.token, "owner"))).toBeUndefined();
    });

    it("有 show:受保護的引用欄照常查得到;沒有另一欄的 show 仍擋", async () => {
      const holder = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [
          M.view,
          M.create,
          M.edit,
          showKey(LOOKUP_FORM, "secret_owner"),
        ],
      });
      expect(
        errorsOf(await lookup(holder.token, "secret_owner")),
      ).toBeUndefined();
      expect(codeOf(await lookup(holder.token, "secret_pick"))).toBe(
        "FORBIDDEN",
      );
    });
  });

  describe("formRuntimeVersion 依讀者權限投影", () => {
    it("沒有 show:受保護欄位與依賴鏈上的計算欄位只回骨架,固定值 / 選項 / 說明 / 公式不外流", async () => {
      const fields = await runtimeFieldsOf(staff.token);
      const byKey = new Map(fields.map((item) => [item.key, item]));
      const serialized = JSON.stringify(fields);
      expect(serialized).not.toContain("4321");
      expect(serialized).not.toContain("內部單價");
      expect(serialized).not.toContain("只有主管看得到的等級說明");
      expect(serialized).not.toContain("1.05");

      expect(byKey.get("price")).toEqual({
        key: "price",
        label: "price",
        type: "number",
        widget: { kind: "number" },
        valueSource: { kind: "constant", value: null },
        permission: { show: true, edit: false },
        redacted: true,
      });
      expect(byKey.get("level")?.options ?? null).toBeNull();
      expect(byKey.get("level")?.help ?? null).toBeNull();
      expect(byKey.get("secret_kind")?.options ?? null).toBeNull();
      // 只因依賴而受保護(total 引用 price;total_tax 引用 total)
      for (const key of ["total", "total_tax"]) {
        expect(byKey.get(key)).toMatchObject({
          redacted: true,
          valueSource: { kind: "computed", expr: null },
        });
      }
      // 公開欄位照回
      expect(byKey.get("kind")).toMatchObject({
        options: { kind: "fieldCategory", key: CATEGORY },
        help: "公開欄位的說明",
        rules: { required: true },
      });
      expect(byKey.get("kind")?.redacted).toBeUndefined();
      expect(fields.map((item) => item.key)).toEqual([
        "title",
        "kind",
        "secret_kind",
        "level",
        "qty",
        "price",
        "total",
        "total_tax",
      ]);
    });

    it("有 show:完整定義照回", async () => {
      const fields = await runtimeFieldsOf(manager.token);
      const byKey = new Map(fields.map((item) => [item.key, item]));
      expect(byKey.get("price")).toMatchObject({
        valueSource: { kind: "constant", value: 4321 },
        help: "內部單價",
      });
      expect(byKey.get("level")?.options).toMatchObject({ kind: "static" });
      expect(byKey.get("total_tax")?.valueSource).toEqual({
        kind: "computed",
        expr: { "*": [{ var: "total" }, 1.05] },
      });
      expect(fields.some((item) => item.redacted === true)).toBe(false);
    });

    it("權限列被刪:持模組 `*` 者只看到骨架,只有超級管理員看到完整定義", async () => {
      const DELETED = "options_deleted_perm";
      await publishNewForm(
        api,
        root,
        DELETED,
        definitionOf([
          field("title", "text"),
          field("secret_price", "number", {
            valueSource: { kind: "constant", value: 9876 },
            permission: { show: true, edit: false },
          }),
        ]),
      );
      await assignForm(api, root, DELETED, [tenant]);
      const wildcard = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.all],
      });
      const secretOf = async (token: string): Promise<FieldDef | undefined> => {
        const data = await ok<RuntimeVersionPayload>(
          api,
          token,
          FORM_RUNTIME_VERSION,
          { formKey: DELETED, version: 1 },
        );
        return data.formRuntimeVersion.formVersion.fields.find(
          (item) => item.key === "secret_price",
        );
      };
      // 權限列還在:`*` 展開後涵蓋它
      expect(await secretOf(wildcard.token)).toMatchObject({
        valueSource: { kind: "constant", value: 9876 },
      });

      await connection
        .collection("permissions")
        .deleteOne({ key: showKey(DELETED, "secret_price") });

      expect(await secretOf(wildcard.token)).toMatchObject({
        redacted: true,
        valueSource: { kind: "constant", value: null },
      });
      expect(await secretOf(root)).toMatchObject({
        valueSource: { kind: "constant", value: 9876 },
      });
    });
  });
});
