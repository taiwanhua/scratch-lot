import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { FieldDef, FormDefinition } from "@repo/domain/form";
import type { FormDefinitionSeedSet } from "@repo/domain/seed";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createOrg, findRootOrgId } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  type SeedTestApp,
  auditCount,
  definitionDoc,
  installationsOf,
  persistedStateOf,
  runSeed,
  seedHashes,
  startSeedTestApp,
  versionDocs,
} from "../../seed/test-support/seed-fixtures";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  F,
  FORK_FORM,
  FORMS_MODULES,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  RETIRE_CURRENT,
  UPDATE_FORM,
  assignForm,
  call,
  codeOf,
  column,
  createOperator,
  definitionOf,
  extensionsOf,
  field,
  ok,
  publishDefinition,
  publishNewForm,
} from "../test-support/form-fixtures";
import {
  EXPORT_FORM_SEED,
  type PortableIssueRow,
  type SeedFile,
  evaluateSeedSource,
  registerExportedSeeds,
  typeCheckSeedSource,
} from "../test-support/seed-export-support";

jest.setTimeout(FORM_TEST_TIMEOUT_MS * 3);

const FORM = "form-definition";

const FORM_RUNTIME_VERSION = /* GraphQL */ `
  query FormRuntimeVersion($formKey: ID!, $version: Int!) {
    formRuntimeVersion(formKey: $formKey, version: $version) {
      formVersion {
        fields
      }
    }
  }
`;

interface ExportData {
  exportFormSeed: SeedFile;
}

/** 名稱、說明、公式、發布說明裡可能出現、放進原始碼有風險的文字。 */
const HOSTILE_NAME = '報銷單 "${process.exit(1)}" `x` </script>';
const HOSTILE_CHANGELOG = [
  "第二版:`; throw new Error('injected'); `",
  String.raw`"quoted" 'single' \backslash\\`,
  `行分隔${String.fromCodePoint(0x20_28)}雙向${String.fromCodePoint(0x20_2e)}結尾 😀`,
  "*/ export const seed = null; /*",
].join("\n");
const HOSTILE_HELP = "第一行\n第二行\t${not_a_template} \\ 結尾";

/** 一份用到各種可攜寫法的定義(受保護欄位、公式、受管類別、引用、明細、帶入)。 */
function fullDefinition(): FormDefinition {
  const fields: FieldDef[] = [
    field("title", "text", { label: HOSTILE_NAME, help: HOSTILE_HELP }),
    field("amount", "number", {
      label: "內部金額",
      help: "只有財務看得到的說明",
      permission: { show: true, edit: true },
    }),
    field("total", "number", {
      valueSource: { kind: "computed", expr: { "*": [{ var: "amount" }, 2] } },
    }),
    field("kind", "select", {
      options: { kind: "fieldCategory", key: "gender" },
    }),
    // 文字欄的 24 碼常數只是文字,不會被當成環境 id
    field("code", "text", {
      default: { kind: "constant", value: "65a1b2c3d4e5f6a7b8c9d0e1" },
    }),
    field("owner", "reference", {
      source: {
        provider: "user",
        labelField: "name",
        filter: { enabled: true },
      },
      default: { kind: "expression", expr: { var: "ctx.user.id" } },
    }),
    field("note", "multiline", {
      visibleWhen: { "==": [{ var: "owner" }, { var: "ctx.user.id" }] },
    }),
    field("items", "array", {
      columns: [column("name", "text"), column("qty", "number")],
    }),
  ];
  return definitionOf(fields, {
    prefills: [
      {
        label: "從使用者帶入",
        source: { provider: "user", labelField: "name" },
        mapping: [{ sourceField: "name", fieldKey: "code" }],
      },
    ],
  });
}

function jsonOf<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function inputOf(
  formKey: string,
  version: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { formKey, version, revision: "r1", changelog: "匯出", ...overrides };
}

function byText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hant");
}

/** 一版的設計內容與發布資訊(比對兩個環境發布出來的是不是同一份)。 */
function contentOf(
  version: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    fields: version?.fields,
    layout: version?.layout,
    summaryMap: version?.summaryMap,
    prefills: version?.prefills,
    changelog: version?.changelog,
    status: version?.status,
  };
}

/**
 * `exportFormSeed`(API 與匯出規則見 `docs/modules/forms.md`):
 * 真 Nest app、真 `/graphql`、隔離的 MongoDB(TEST-07)。可攜性規則的逐條正反例在
 * `packages/domain/src/seed/portable-*.test.ts`;這裡驗端點的守門、指名版本、輸出內容、
 * 無副作用,以及匯出檔經型別檢查、專案 registry 組裝到真發布後內容一致。
 */
describe("exportFormSeed:把共用表單的已發布版本匯出成專案設定", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let rootOrg: Types.ObjectId;
  let tenant: Types.ObjectId;
  /** 站在根組織、不是超級管理員:`system.forms.view` + `edit`,表單模組只有 `view`(沒有任何欄位的 show)。 */
  let designer: FormOperator;
  let viewer: FormOperator;
  let editorOnly: FormOperator;
  /** 站在租戶內,表單管理權限全開。 */
  let tenantAdmin: FormOperator;

  const exportSeed = (
    token: string,
    input: Record<string, unknown>,
  ): ReturnType<typeof call<ExportData>> =>
    call<ExportData>(api, token, EXPORT_FORM_SEED, { input });

  const exportOk = async (
    token: string,
    input: Record<string, unknown>,
  ): Promise<SeedFile> => {
    const data = await ok<ExportData>(api, token, EXPORT_FORM_SEED, { input });
    return data.exportFormSeed;
  };

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-form-seed-export");
    ({ api, connection } = app);
    rootOrg = await findRootOrgId(connection);
    tenant = await createOrg(connection, { name: "匯出測試租戶" });
    const rootOperator = (permissionKeys: string[]): Promise<FormOperator> =>
      createOperator(api, connection, {
        orgId: rootOrg,
        moduleKeys: [...FORMS_MODULES, MODULE_KEY],
        permissionKeys,
      });
    designer = await rootOperator([F.view, F.edit, M.view]);
    viewer = await rootOperator([F.view]);
    editorOnly = await rootOperator([F.edit]);
    tenantAdmin = await createOperator(api, connection, {
      orgId: tenant,
      moduleKeys: [...FORMS_MODULES, MODULE_KEY],
      permissionKeys: [F.all, M.all],
    });
  }, HOOK_TIMEOUT_MS * 2);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("允許:站在根組織、view + edit、共用表單的已發布版本", () => {
    it("匯出指名的版本:檔名、完整設計內容(不是執行端遮過的投影)、特殊文字原樣、不含任何環境資料;匯出前後資料庫逐欄不變", async () => {
      const key = "exp_full";
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([field("title", "text")]),
        HOSTILE_NAME,
      );
      const definition = fullDefinition();
      const published = await publishDefinition(
        api,
        app.root,
        key,
        definition,
        1,
      );
      expect(published.version).toBe(2);
      await ok(api, app.root, UPDATE_FORM, {
        input: { key, tabLabelTemplate: "{{title}} `${x}`" },
      });
      const before = await persistedStateOf(connection, FORM, key);

      const file = await exportOk(
        designer.token,
        inputOf(key, 2, {
          revision: "r2-final_1",
          changelog: HOSTILE_CHANGELOG,
        }),
      );

      expect(file.fileName).toBe("exp_full.r2-final_1.seed.ts");
      const expected: FormDefinitionSeedSet = {
        kind: "form-definition",
        key,
        revision: "r2-final_1",
        name: HOSTILE_NAME,
        changelog: HOSTILE_CHANGELOG,
        desiredStatus: "published",
        moduleKey: MODULE_KEY,
        tabLabelTemplate: "{{title}} `${x}`",
        definition: jsonOf(definition),
      };
      const seed = evaluateSeedSource(file.source) as Record<string, unknown>;
      expect(seed).toEqual(expected);
      expect(Object.keys(seed).toSorted(byText)).toEqual(
        Object.keys(expected).toSorted(byText),
      );
      // 匯出的是設計端的完整定義;同一位操作者在執行端讀到的受保護欄位只剩骨架
      const runtime = await ok<{
        formRuntimeVersion: { formVersion: { fields: FieldDef[] } };
      }>(api, designer.token, FORM_RUNTIME_VERSION, {
        formKey: key,
        version: 2,
      });
      expect(
        runtime.formRuntimeVersion.formVersion.fields.find(
          (item) => item.key === "amount",
        ),
      ).toMatchObject({ redacted: true });
      expect(file.source).toContain("只有財務看得到的說明");
      // 不帶來源環境的 id、版號、時間、人員
      const form = await definitionDoc(connection, FORM, key);
      const versions = await versionDocs(connection, FORM, key);
      for (const id of [
        form?._id,
        ...versions.map((version) => version._id),
        app.rootUserId,
        designer.userId,
        rootOrg,
      ]) {
        expect(file.source).not.toContain(String(id));
      }
      for (const leaked of [
        "_id",
        "publishedBy",
        "publishedAt",
        "createdAt",
        "currentVersion",
        "draftRevision",
        "ownerOrgId",
        "baseVersion",
      ]) {
        expect(file.source).not.toContain(leaked);
      }
      // 唯讀:身分、全部版本、權限、安裝紀錄、稽核筆數都沒變
      expect(await persistedStateOf(connection, FORM, key)).toEqual(before);
      expect(await installationsOf(connection, key)).toEqual([]);
      // 同樣的輸入再匯出一次,位元組完全相同
      expect(
        await exportOk(
          app.root,
          inputOf(key, 2, {
            revision: "r2-final_1",
            changelog: HOSTILE_CHANGELOG,
          }),
        ),
      ).toEqual(file);
    });

    it("版本由呼叫端指名:已退役、草稿、不存在的版本都拒絕,不拿目前版本代替;退役目前版本後也不能再匯出它", async () => {
      const key = "exp_versions";
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([field("title", "text")]),
      );
      const second = definitionOf([
        field("title", "text"),
        field("memo", "text"),
      ]);
      await publishDefinition(api, app.root, key, second, 1);
      await ok(api, app.root, CREATE_DRAFT, {
        input: { formKey: key, baseVersion: 2 },
      });

      const current = await exportOk(app.root, inputOf(key, 2));
      expect(
        (evaluateSeedSource(current.source) as FormDefinitionSeedSet).definition
          .fields,
      ).toHaveLength(2);

      const retired = await exportSeed(app.root, inputOf(key, 1));
      expect(retired.data).toBeNull();
      expect(extensionsOf(retired)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["version"],
      });
      const missing = await exportSeed(app.root, inputOf(key, 3));
      expect(codeOf(missing)).toBe("NOT_FOUND");
      // 草稿沒有版號,版號 0 也指不到它
      expect(codeOf(await exportSeed(app.root, inputOf(key, 0)))).toBe(
        "NOT_FOUND",
      );

      await ok(api, app.root, RETIRE_CURRENT, {
        input: { formKey: key, expectedVersion: 2 },
      });
      const afterRetire = await exportSeed(app.root, inputOf(key, 2));
      expect(extensionsOf(afterRetire)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["version"],
      });
    });
  });

  describe("拒絕:權限、身分與輸入(後端自己守,不靠畫面藏按鈕)", () => {
    const key = "exp_guard";
    const customKey = "exp_guard_custom";

    beforeAll(async () => {
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([field("title", "text")]),
      );
      await assignForm(api, app.root, key, [tenant]);
      await ok(api, tenantAdmin.token, FORK_FORM, {
        input: {
          sourceKey: key,
          sourceVersion: 1,
          key: customKey,
          name: "客製",
        },
      });
    });

    it("沒登入、只有 view、只有 edit:一律拒絕且不回任何內容", async () => {
      const anonymous = await api.graphql<ExportData>(EXPORT_FORM_SEED, {
        input: inputOf(key, 1),
      });
      expect(codeOf(anonymous)).toBe("UNAUTHENTICATED");
      for (const operator of [viewer, editorOnly]) {
        const result = await exportSeed(operator.token, inputOf(key, 1));
        expect(result.data).toBeNull();
        expect(codeOf(result)).toBe("FORBIDDEN");
      }
    });

    it("站在租戶內:即使表單管理權限全開、表單也分派給他,仍是 ROOT_ONLY;自己的客製表單也一樣", async () => {
      for (const formKey of [key, customKey]) {
        const result = await exportSeed(tenantAdmin.token, inputOf(formKey, 1));
        expect(result.data).toBeNull();
        expect(extensionsOf(result)).toMatchObject({
          code: "FORBIDDEN",
          reason: "ROOT_ONLY",
        });
      }
    });

    it("租戶的客製表單:站在根組織也匯不出來(當不存在)", async () => {
      const result = await exportSeed(app.root, inputOf(customKey, 1));

      expect(result.data).toBeNull();
      expect(codeOf(result)).toBe("NOT_FOUND");
      expect(codeOf(await exportSeed(app.root, inputOf("exp_nope", 1)))).toBe(
        "NOT_FOUND",
      );
    });

    it("revision 格式不符、發布說明空白:VALIDATION_FAILED 並指出是哪一欄", async () => {
      const cases: [Record<string, unknown>, string[]][] = [
        [{ revision: "R1" }, ["revision"]],
        [{ revision: "" }, ["revision"]],
        [{ revision: "-r1" }, ["revision"]],
        [{ revision: "a".repeat(65) }, ["revision"]],
        [{ changelog: "  \n " }, ["changelog"]],
        [{ revision: "r 1", changelog: "" }, ["revision", "changelog"]],
      ];
      for (const [overrides, fields] of cases) {
        const result = await exportSeed(app.root, inputOf(key, 1, overrides));
        expect(result.data).toBeNull();
        expect(extensionsOf(result)).toMatchObject({
          code: "VALIDATION_FAILED",
          fields,
        });
      }
      const longest = await exportOk(
        app.root,
        inputOf(key, 1, { revision: "a".repeat(64) }),
      );
      expect(longest.fileName).toBe(`${key}.${"a".repeat(64)}.seed.ts`);
    });
  });

  describe("可攜性:夾帶環境資料或缺受管依賴時整份不匯出,逐項指出位置", () => {
    it("本地 id 條件、引用固定值、未受管類別、客製表單帶入、ID 與寫死值比較(含帶入後的間接 ID)", async () => {
      const key = "exp_portable";
      const customKey = "exp_portable_custom";
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([field("title", "text")]),
      );
      await assignForm(api, app.root, key, [tenant]);
      await ok(api, tenantAdmin.token, FORK_FORM, {
        input: {
          sourceKey: key,
          sourceVersion: 1,
          key: customKey,
          name: "客製",
        },
      });
      // root 在畫面上自建的類別:不是 seed 宣告的受管類別
      await connection.collection("field_categories").insertOne({
        key: "local-category",
        name: "現場類別",
        isSystem: false,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      const fields: FieldDef[] = [
        field("title", "text"),
        field("approver", "reference", {
          source: {
            provider: "user",
            labelField: "name",
            filter: { orgId: String(tenant) },
          },
          default: {
            kind: "constant",
            value: { value: String(app.rootUserId), label: "root" },
          },
        }),
        field("kind", "select", {
          options: { kind: "fieldCategory", key: "local-category" },
        }),
        field("note", "text", {
          visibleWhen: { "==": [{ var: "approver" }, "u-1"] },
        }),
        field("copied", "text"),
        field("flag", "text", {
          visibleWhen: { "==": [{ var: "copied" }, "fixed"] },
        }),
      ];
      const definition = definitionOf(fields, {
        prefills: [
          {
            label: "帶入使用者 id",
            source: { provider: "user", labelField: "name" },
            mapping: [{ sourceField: "id", fieldKey: "copied" }],
          },
          {
            label: "從客製表單帶入",
            source: {
              provider: "form_submission",
              labelField: "title",
              formKey: customKey,
            },
            mapping: [{ sourceField: "title", fieldKey: "title" }],
          },
        ],
      });
      // 其中幾項過不了設計端的檢查器,所以直接改寫已發布的那一版,固定可攜性檢查的輸入
      await connection
        .collection("form_versions")
        .updateOne({ formKey: key, version: 1 }, { $set: { ...definition } });
      const auditsBefore = await auditCount(connection);

      const result = await exportSeed(app.root, inputOf(key, 1));

      expect(result.data).toBeNull();
      const extensions = extensionsOf(result) as {
        code: string;
        fields: string[];
        issues: PortableIssueRow[];
      };
      expect(extensions.code).toBe("VALIDATION_FAILED");
      expect(extensions.fields).toEqual(["definition"]);
      expect(
        extensions.issues
          .map(({ code, path }) => `${path} ${code}`)
          .toSorted(byText),
      ).toEqual([
        "definition.fields.1.default.value FIXED_ENVIRONMENT_VALUE",
        "definition.fields.1.source.filter.orgId LOOKUP_FILTER_UNSUPPORTED",
        "definition.fields.2.options.key DEPENDENCY_UNRESOLVED",
        // 位置指到表達式裡寫死的那個運算元
        "definition.fields.3.visibleWhen.==.1 ID_COMPARISON",
        "definition.fields.5.visibleWhen.==.1 ID_COMPARISON",
        "definition.prefills.1.source.formKey DEPENDENCY_UNRESOLVED",
      ]);
      // 每一筆都有給人看的修正原因;客製表單講得出是租戶的
      expect(extensions.issues.every(({ message }) => message !== "")).toBe(
        true,
      );
      expect(
        extensions.issues.find(
          ({ path }) => path === "definition.prefills.1.source.formKey",
        )?.message,
      ).toContain("租戶客製表單");
      expect(await auditCount(connection)).toBe(auditsBefore);
    });

    it("引用另一張共用表單:它有目前版本就可解析;沒有發布過就指出缺依賴", async () => {
      const source = "exp_dep_source";
      const draftOnly = "exp_dep_draft";
      await publishNewForm(
        api,
        app.root,
        source,
        definitionOf([field("title", "text")]),
      );
      await ok(api, app.root, CREATE_FORM, {
        input: { key: draftOnly, moduleKey: MODULE_KEY, name: "還沒發布" },
      });
      const referencing = (formKey: string): FormDefinition =>
        definitionOf([field("title", "text")], {
          prefills: [
            {
              label: "從別張表單帶入",
              source: {
                provider: "form_submission",
                labelField: "title",
                formKey,
              },
              mapping: [{ sourceField: "title", fieldKey: "title" }],
            },
          ],
        });
      await publishNewForm(api, app.root, "exp_dep_ok", referencing(source));
      await publishNewForm(
        api,
        app.root,
        "exp_dep_missing",
        definitionOf([field("title", "text")]),
      );
      await connection
        .collection("form_versions")
        .updateOne(
          { formKey: "exp_dep_missing", version: 1 },
          { $set: { prefills: referencing(draftOnly).prefills } },
        );

      const resolved = await exportOk(app.root, inputOf("exp_dep_ok", 1));
      const missing = await exportSeed(app.root, inputOf("exp_dep_missing", 1));

      expect(resolved.fileName).toBe("exp_dep_ok.r1.seed.ts");
      expect(
        (extensionsOf(missing) as { issues: PortableIssueRow[] }).issues.map(
          ({ code, path }) => ({ code, path }),
        ),
      ).toEqual([
        {
          code: "DEPENDENCY_UNRESOLVED",
          path: "definition.prefills.0.source.formKey",
        },
      ]);
    });
  });

  describe("表單設定:依欄位共用", () => {
    it("有設才輸出 sharedByFieldKeys(沒設的匯出檔沒有這個鍵)", async () => {
      const key = "exp_shared_by";
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([
          field("title", "text"),
          field("branch", "reference", {
            source: { provider: "org", labelField: "name" },
          }),
        ]),
      );
      const before = await exportOk(app.root, inputOf(key, 1));
      const plain = evaluateSeedSource(before.source) as FormDefinitionSeedSet;
      expect(plain).not.toHaveProperty("sharedByFieldKeys");

      await ok(api, app.root, UPDATE_FORM, {
        input: { key, sharedByFieldKeys: ["branch"] },
      });
      const file = await exportOk(app.root, inputOf(key, 1));
      expect(typeCheckSeedSource(file.source)).toEqual([]);
      const exported = evaluateSeedSource(file.source) as FormDefinitionSeedSet;
      expect(exported.sharedByFieldKeys).toEqual(["branch"]);
    });
  });

  describe("匯出 → 型別檢查 → 專案 registry → 真發布", () => {
    it("匯出檔原樣通過 SeedSet 型別檢查與 registry 組裝;來源環境採納原版本,空的環境發布出同樣的內容(含關掉的允許存草稿)", async () => {
      const key = "exp_roundtrip";
      await publishNewForm(
        api,
        app.root,
        key,
        definitionOf([field("title", "text")]),
        HOSTILE_NAME,
      );
      await publishDefinition(api, app.root, key, fullDefinition(), 1);
      await ok(api, app.root, UPDATE_FORM, {
        input: {
          key,
          tabLabelTemplate: "{{title}}",
          allowDraft: false,
          voidReasonCategoryKey: "reprint-reason",
        },
      });

      const file = await exportOk(
        app.root,
        inputOf(key, 2, { revision: "r2", changelog: HOSTILE_CHANGELOG }),
      );

      expect(typeCheckSeedSource(file.source)).toEqual([]);
      const exported = evaluateSeedSource(file.source) as FormDefinitionSeedSet;
      // 允許存草稿關著:匯出檔保留這個設定
      expect(exported.allowDraft).toBe(false);
      // 作廢原因類別有設:匯出檔保留
      expect(exported.voidReasonCategoryKey).toBe("reprint-reason");
      // 登記進專案 registry(與底座的模組、欄位類別一起組裝)後仍是同一份宣告
      const registered = registerExportedSeeds([file]);
      expect(registered).toEqual([exported]);
      const [seed] = registered as [FormDefinitionSeedSet];

      // 來源環境:內容與畫面發布的那一版相同 → 採納,保留 id 與版號,不另發一版
      const sourceForm = await definitionDoc(connection, FORM, key);
      const sourceVersions = await versionDocs(connection, FORM, key);
      const adopted = await runSeed(app, seed);
      expect(adopted).toMatchObject({
        outcome: "adopted",
        conflict: null,
        definitionId: String(sourceForm?._id),
        localVersion: 2,
        ...seedHashes(exported),
      });
      expect(await versionDocs(connection, FORM, key)).toEqual(sourceVersions);

      // 另一個環境(這裡把這張表單的身分、版本、權限與安裝紀錄清掉代表它):依同一份宣告真的發布
      const sourceContent = {
        ...contentOf(sourceVersions.at(-1)),
        changelog: HOSTILE_CHANGELOG,
      };
      await connection.collection("forms").deleteOne({ key });
      await connection.collection("form_versions").deleteMany({ formKey: key });
      await connection
        .collection("permissions")
        .deleteMany({ key: { $regex: `-${key}-` } });
      await connection
        .collection("seed_definition_installations")
        .deleteMany({ key });

      const created = await runSeed(app, seed);

      expect(created).toMatchObject({
        outcome: "created",
        conflict: null,
        localVersion: 1,
        contentHash: adopted.contentHash,
        snapshotHash: adopted.snapshotHash,
      });
      expect(created.definitionId).not.toBe(adopted.definitionId);
      expect(await definitionDoc(connection, FORM, key)).toMatchObject({
        name: HOSTILE_NAME,
        moduleKey: MODULE_KEY,
        ownerOrgId: null,
        tabLabelTemplate: "{{title}}",
        allowDraft: false,
        voidReasonCategoryKey: "reprint-reason",
        currentVersion: 1,
      });
      const targetVersions = await versionDocs(connection, FORM, key);
      expect(targetVersions).toHaveLength(1);
      expect(contentOf(targetVersions[0])).toEqual(sourceContent);
      // 新環境再匯出一次(版號不同):內容與原匯出檔一字不差
      expect(
        await exportOk(
          app.root,
          inputOf(key, 1, { revision: "r2", changelog: HOSTILE_CHANGELOG }),
        ),
      ).toEqual(file);
    });
  });
});
