import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type {
  DefinitionSeedSet,
  WorkflowDefinitionSeedSet,
} from "@repo/domain/seed";
import type { StepDef } from "@repo/domain/workflow";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { findRootOrgId } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FORK_FORM,
  call,
  codeOf,
  extensionsOf,
  ok,
} from "../../forms/test-support/form-fixtures";
import {
  EXPORT_FORM_SEED,
  EXPORT_WORKFLOW_SEED,
  type PortableIssueRow,
  type SeedFile,
  evaluateSeedSource,
  registerExportedSeeds,
  typeCheckSeedSource,
} from "../../forms/test-support/seed-export-support";
import {
  type SeedTestApp,
  auditCount,
  definitionDoc,
  installationsOf,
  persistedStateOf,
  runSeed,
  runSeeds,
  seedHashes,
  startSeedTestApp,
  versionDocs,
} from "../../seed/test-support/seed-fixtures";
import {
  ASSIGN_WORKFLOW,
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  FORM_KEY,
  type Person,
  RETIRE_WORKFLOW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  person,
  publishWorkflow,
  publishWorkflowDraft,
  setupWorld,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const WORKFLOW = "workflow-definition";
const FLOW_MODULES = ["system", "system.workflows"];
const VIEW = "system.workflows.view";
const PUBLISH = "system.workflows.publish";

interface ExportData {
  exportWorkflowSeed: SeedFile;
}

const HOSTILE_NAME = '請假審核 "${process.exit(1)}" `x` </script>';
const HOSTILE_CHANGELOG = [
  "第二版:`; throw new Error('injected'); `",
  String.raw`"quoted" 'single' \backslash\\`,
  `行分隔${String.fromCodePoint(0x20_28)}雙向${String.fromCodePoint(0x20_2e)}結尾 😀`,
].join("\n");

/** 共用流程可攜的四種關卡(寫成設計服務存下來的形狀):主管、角色佔位、表單欄位、匯合。 */
function portableSteps(): StepDef[] {
  return [
    {
      key: "boss",
      name: "直屬主管 `${x}`",
      assignee: { kind: "manager", level: 1 },
      mode: "any",
      skipWhen: { "<=": [{ var: "days" }, 1] },
      allowReturn: true,
    },
    {
      key: "hr",
      name: "人資",
      assignee: { kind: "role", roleId: null, placeholder: "人資" },
      mode: "all",
    },
    {
      key: "picked",
      name: "指定審核者",
      assignee: { kind: "field", formKey: FORM_KEY, fieldKey: "approver" },
      mode: "any",
      // 動態 ID 與系統值比較:可攜
      skipWhen: { "==": [{ var: "approver" }, { var: "ctx.user.id" }] },
    },
    { key: "merge", name: "匯合", kind: "join" },
  ] as unknown as StepDef[];
}

const PORTABLE_EDGES = [
  { from: "boss", to: "hr" },
  { from: "boss", to: "picked" },
  { from: "hr", to: "merge" },
  { from: "picked", to: "merge" },
];

/** 只有一關直屬主管(不引用任何表單欄位)。 */
function bossOnly(): StepDef[] {
  return [
    {
      key: "boss",
      name: "直屬主管",
      assignee: { kind: "manager", level: 1 },
      mode: "any",
    },
  ] as unknown as StepDef[];
}

function inputOf(
  workflowKey: string,
  version: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    workflowKey,
    version,
    revision: "r1",
    changelog: "匯出",
    ...overrides,
  };
}

function byText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hant");
}

/** 一版的設計內容與發布資訊(比對兩個環境發布出來的是不是同一份)。 */
function contentOf(
  version: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    steps: version?.steps,
    edges: version?.edges,
    checkFormKey: version?.checkFormKey,
    changelog: version?.changelog,
    status: version?.status,
  };
}

/**
 * `exportWorkflowSeed`(API 與匯出規則見 `docs/modules/workflows.md`):
 * 真 Nest app、真 `/graphql`、隔離的 MongoDB(TEST-07)。與表單的匯出共用同一套可攜性檢查與輸出
 * (`forms/form-design/seed-export.ts`);這裡驗流程這一側的守門、指名版本、輸出內容、無副作用,
 * 以及匯出檔連同它引用的表單經型別檢查、專案 registry 組裝到真發布後內容一致。
 */
describe("exportWorkflowSeed:把共用流程的已發布版本匯出成專案設定", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;
  let rootOrg: Types.ObjectId;
  /** 站在根組織、不是超級管理員:`system.workflows.view` + `publish`。 */
  let designer: Person;
  let viewer: Person;
  let publisherOnly: Person;

  const exportSeed = (
    token: string,
    input: Record<string, unknown>,
  ): ReturnType<typeof call<ExportData>> =>
    call<ExportData>(api, token, EXPORT_WORKFLOW_SEED, { input });

  const exportOk = async (
    token: string,
    input: Record<string, unknown>,
  ): Promise<SeedFile> => {
    const data = await ok<ExportData>(api, token, EXPORT_WORKFLOW_SEED, {
      input,
    });
    return data.exportWorkflowSeed;
  };

  /** root 在畫面上建共用流程並發布第一版。 */
  const publishShared = async (
    key: string,
    steps: StepDef[],
    name = `流程 ${key}`,
  ): Promise<void> => {
    await ok(api, world.root, CREATE_WORKFLOW, { input: { key, name } });
    await publishWorkflowDraft(world, key, { steps }, null, world.root);
  };

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-workflow-seed-export");
    ({ api, connection } = app);
    world = await setupWorld(api, connection, 0);
    rootOrg = await findRootOrgId(connection);
    const rootPerson = (permissionKeys: string[]): Promise<Person> =>
      person(api, connection, rootOrg, rootOrg, {
        moduleKeys: FLOW_MODULES,
        permissionKeys,
      });
    designer = await rootPerson([VIEW, PUBLISH]);
    viewer = await rootPerson([VIEW]);
    publisherOnly = await rootPerson([PUBLISH]);
  }, HOOK_TIMEOUT_MS * 3);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("允許:站在根組織、view + publish、共用流程的已發布版本", () => {
    it("匯出指名的版本:檔名、完整的關卡 / 連線 / 檢查用表單、特殊文字原樣、不含任何環境資料;匯出前後資料庫逐欄不變", async () => {
      const key = "exp_flow";
      await publishShared(key, bossOnly(), HOSTILE_NAME);
      const published = await publishWorkflowDraft(
        world,
        key,
        {
          steps: portableSteps(),
          edges: PORTABLE_EDGES,
          checkFormKey: FORM_KEY,
        },
        1,
        world.root,
      );
      expect(published.version).toBe(2);
      const before = await persistedStateOf(connection, WORKFLOW, key);

      const file = await exportOk(
        designer.token,
        inputOf(key, 2, {
          revision: "r2-final_1",
          changelog: HOSTILE_CHANGELOG,
        }),
      );

      expect(file.fileName).toBe("exp_flow.r2-final_1.seed.ts");
      const expected: WorkflowDefinitionSeedSet = {
        kind: "workflow-definition",
        key,
        revision: "r2-final_1",
        name: HOSTILE_NAME,
        changelog: HOSTILE_CHANGELOG,
        desiredStatus: "published",
        checkFormKey: FORM_KEY,
        definition: { steps: portableSteps(), edges: PORTABLE_EDGES },
      };
      const seed = evaluateSeedSource(file.source) as Record<string, unknown>;
      expect(seed).toEqual(expected);
      expect(Object.keys(seed).toSorted(byText)).toEqual(
        Object.keys(expected).toSorted(byText),
      );
      // 不帶來源環境的 id、版號、時間、人員、分派
      const workflow = await definitionDoc(connection, WORKFLOW, key);
      const versions = await versionDocs(connection, WORKFLOW, key);
      for (const id of [
        workflow?._id,
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
        "tenantId",
        "baseVersion",
      ]) {
        expect(file.source).not.toContain(leaked);
      }
      // 唯讀:身分、全部版本、安裝紀錄、稽核筆數都沒變
      expect(await persistedStateOf(connection, WORKFLOW, key)).toEqual(before);
      expect(await installationsOf(connection, key)).toEqual([]);
    });

    it("版本由呼叫端指名:已退役、草稿、不存在的版本都拒絕,不拿目前版本代替;退役目前版本後也不能再匯出它", async () => {
      const key = "exp_flow_versions";
      await publishShared(key, bossOnly());
      const twoSteps = [...bossOnly(), ...portableSteps().slice(1, 2)];
      await publishWorkflowDraft(
        world,
        key,
        { steps: twoSteps },
        1,
        world.root,
      );
      await ok(api, world.root, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: 2 },
      });

      const current = await exportOk(world.root, inputOf(key, 2));
      expect(
        (evaluateSeedSource(current.source) as WorkflowDefinitionSeedSet)
          .definition.steps,
      ).toHaveLength(2);

      const retired = await exportSeed(world.root, inputOf(key, 1));
      expect(retired.data).toBeNull();
      expect(extensionsOf(retired)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["version"],
      });
      expect(codeOf(await exportSeed(world.root, inputOf(key, 3)))).toBe(
        "NOT_FOUND",
      );
      expect(codeOf(await exportSeed(world.root, inputOf(key, 0)))).toBe(
        "NOT_FOUND",
      );

      await connection
        .collection("workflow_versions")
        .deleteOne({ workflowKey: key, status: "draft" });
      await ok(api, world.root, RETIRE_WORKFLOW, {
        input: { workflowKey: key },
      });
      expect(
        extensionsOf(await exportSeed(world.root, inputOf(key, 2))),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["version"] });
    });

    it("租戶邊界是共用、擁有組織卻有值的流程(正常寫入不會產生):不當成共用流程,當不存在", async () => {
      const key = "exp_flow_owner";
      await publishShared(key, bossOnly());
      await connection
        .collection("workflows")
        .updateOne({ key }, { $set: { ownerOrgId: world.tenant } });

      const result = await exportSeed(world.root, inputOf(key, 1));

      expect(result.data).toBeNull();
      expect(codeOf(result)).toBe("NOT_FOUND");
    });
  });

  describe("拒絕:權限、身分與輸入(後端自己守,不靠畫面藏按鈕)", () => {
    const key = "exp_flow_guard";
    const customKey = "exp_flow_guard_custom";

    beforeAll(async () => {
      await publishShared(key, bossOnly());
      await ok(api, world.root, ASSIGN_WORKFLOW, {
        input: { workflowKey: key, tenantOrgIds: [String(world.tenant)] },
      });
      await publishWorkflow(world, customKey, { steps: bossOnly() });
    });

    it("沒登入、只有 view、只有 publish:一律拒絕且不回任何內容", async () => {
      const anonymous = await api.graphql<ExportData>(EXPORT_WORKFLOW_SEED, {
        input: inputOf(key, 1),
      });
      expect(codeOf(anonymous)).toBe("UNAUTHENTICATED");
      for (const operator of [viewer, publisherOnly]) {
        const result = await exportSeed(operator.token, inputOf(key, 1));
        expect(result.data).toBeNull();
        expect(codeOf(result)).toBe("FORBIDDEN");
      }
    });

    it("站在租戶內:即使流程管理權限全開、流程也分派給他,仍是 ROOT_ONLY;自己的客製流程也一樣", async () => {
      for (const workflowKey of [key, customKey]) {
        const result = await exportSeed(
          world.admin.token,
          inputOf(workflowKey, 1),
        );
        expect(result.data).toBeNull();
        expect(extensionsOf(result)).toMatchObject({
          code: "FORBIDDEN",
          reason: "ROOT_ONLY",
        });
      }
    });

    it("租戶的客製流程:站在根組織也匯不出來(當不存在)", async () => {
      const result = await exportSeed(world.root, inputOf(customKey, 1));

      expect(result.data).toBeNull();
      expect(codeOf(result)).toBe("NOT_FOUND");
      expect(
        codeOf(await exportSeed(world.root, inputOf("exp_flow_nope", 1))),
      ).toBe("NOT_FOUND");
    });

    it("revision 格式不符、發布說明空白:VALIDATION_FAILED 並指出是哪一欄", async () => {
      const cases: [Record<string, unknown>, string[]][] = [
        [{ revision: "R1" }, ["revision"]],
        [{ revision: "a".repeat(65) }, ["revision"]],
        [{ changelog: "  \n " }, ["changelog"]],
        [{ revision: "", changelog: "" }, ["revision", "changelog"]],
      ];
      for (const [overrides, fields] of cases) {
        const result = await exportSeed(world.root, inputOf(key, 1, overrides));
        expect(result.data).toBeNull();
        expect(extensionsOf(result)).toMatchObject({
          code: "VALIDATION_FAILED",
          fields,
        });
      }
    });
  });

  describe("可攜性:夾帶環境資料或缺受管依賴時整份不匯出,逐項指出位置", () => {
    it("指名使用者、寫死角色、指向客製表單的欄位、ID 與寫死值比較、檢查用表單不可解析", async () => {
      const key = "exp_flow_portable";
      const customForm = `${FORM_KEY}_exp`;
      await publishShared(key, bossOnly());
      await ok(api, world.admin.token, FORK_FORM, {
        input: {
          sourceKey: FORM_KEY,
          sourceVersion: 1,
          key: customForm,
          name: "客製病假單",
        },
      });
      const steps = [
        {
          key: "named",
          name: "指名",
          assignee: { kind: "users", userIds: [String(world.manager.userId)] },
          mode: "any",
        },
        {
          key: "fixed_role",
          name: "寫死角色",
          assignee: {
            kind: "role",
            roleId: String(world.hrRoleId),
            placeholder: null,
          },
          mode: "any",
        },
        {
          key: "custom_field",
          name: "客製表單欄位",
          assignee: {
            kind: "field",
            formKey: customForm,
            fieldKey: "approver",
          },
          mode: "any",
        },
        {
          key: "compare",
          name: "比較",
          assignee: { kind: "manager", level: 1 },
          mode: "any",
          skipWhen: { "==": [{ var: "approver" }, "u-1"] },
        },
      ];
      // 共用流程的檢查器不讓這些內容發布,所以直接改寫已發布的那一版,固定可攜性檢查的輸入
      await connection
        .collection("workflow_versions")
        .updateOne(
          { workflowKey: key, version: 1 },
          { $set: { steps, checkFormKey: FORM_KEY } },
        );
      const auditsBefore = await auditCount(connection);

      const result = await exportSeed(world.root, inputOf(key, 1));

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
        "definition.steps.0.assignee.userIds ASSIGNEE_NOT_PORTABLE",
        "definition.steps.1.assignee.placeholder ASSIGNEE_NOT_PORTABLE",
        "definition.steps.1.assignee.roleId ASSIGNEE_NOT_PORTABLE",
        "definition.steps.2.assignee.formKey ASSIGNEE_NOT_PORTABLE",
        // 位置指到表達式裡寫死的那個運算元
        "definition.steps.3.skipWhen.==.1 ID_COMPARISON",
      ]);
      expect(extensions.issues.every(({ message }) => message !== "")).toBe(
        true,
      );
      expect(
        extensions.issues.find(
          ({ path }) => path === "definition.steps.2.assignee.formKey",
        )?.message,
      ).toContain("租戶客製表單");
      expect(await auditCount(connection)).toBe(auditsBefore);

      await connection
        .collection("workflow_versions")
        .updateOne(
          { workflowKey: key, version: 1 },
          { $set: { steps: bossOnly(), checkFormKey: "exp_no_such_form" } },
        );
      const unresolved = await exportSeed(world.root, inputOf(key, 1));
      expect(
        (extensionsOf(unresolved) as { issues: PortableIssueRow[] }).issues.map(
          ({ code, path }) => `${path} ${code}`,
        ),
      ).toEqual(["checkFormKey DEPENDENCY_UNRESOLVED"]);
    });
  });

  describe("匯出 → 型別檢查 → 專案 registry → 真發布", () => {
    it("流程與它引用的表單一起匯出:通過 SeedSet 型別檢查與 registry 組裝(表單排在流程前);來源環境採納原版本,空的環境發布出同樣的內容", async () => {
      const key = "exp_flow_roundtrip";
      await publishShared(key, bossOnly(), HOSTILE_NAME);
      await publishWorkflowDraft(
        world,
        key,
        {
          steps: portableSteps(),
          edges: PORTABLE_EDGES,
          checkFormKey: FORM_KEY,
        },
        1,
        world.root,
      );

      const flowFile = await exportOk(
        world.root,
        inputOf(key, 2, { revision: "r2", changelog: HOSTILE_CHANGELOG }),
      );
      const formData = await ok<{ exportFormSeed: SeedFile }>(
        api,
        world.root,
        EXPORT_FORM_SEED,
        {
          input: {
            formKey: FORM_KEY,
            version: 1,
            revision: "r1",
            changelog: "病假單第一版",
          },
        },
      );
      const formFile = formData.exportFormSeed;

      expect(typeCheckSeedSource(flowFile.source)).toEqual([]);
      expect(typeCheckSeedSource(formFile.source)).toEqual([]);
      const exportedFlow = evaluateSeedSource(
        flowFile.source,
      ) as WorkflowDefinitionSeedSet;
      const exportedForm = evaluateSeedSource(
        formFile.source,
      ) as DefinitionSeedSet;
      // 刻意把流程登記在它引用的表單前面:順序由組裝排
      const registered = registerExportedSeeds([flowFile, formFile]);
      expect(registered).toEqual([exportedForm, exportedFlow]);

      // 來源環境:兩份都與畫面發布的版本相同 → 採納,保留 id 與版號
      const sourceFlow = await definitionDoc(connection, WORKFLOW, key);
      const sourceVersions = await versionDocs(connection, WORKFLOW, key);
      const adopted = await runSeeds(app, registered);
      expect(adopted.errors).toEqual([]);
      expect(adopted.results.map(({ outcome }) => outcome)).toEqual([
        "adopted",
        "adopted",
      ]);
      expect(adopted.results[1]).toMatchObject({
        definitionId: String(sourceFlow?._id),
        localVersion: 2,
        conflict: null,
        ...seedHashes(exportedFlow),
      });
      expect(await versionDocs(connection, WORKFLOW, key)).toEqual(
        sourceVersions,
      );

      // 另一個環境(這裡把這個流程的身分、版本與安裝紀錄清掉代表它):依同一份宣告真的發布
      const sourceContent = {
        ...contentOf(sourceVersions.at(-1)),
        changelog: HOSTILE_CHANGELOG,
      };
      await connection.collection("workflows").deleteOne({ key });
      await connection
        .collection("workflow_versions")
        .deleteMany({ workflowKey: key });
      await connection
        .collection("seed_definition_installations")
        .deleteMany({ key });

      const created = await runSeed(app, exportedFlow);

      expect(created).toMatchObject({
        outcome: "created",
        conflict: null,
        localVersion: 1,
        contentHash: adopted.results[1]?.contentHash,
        snapshotHash: adopted.results[1]?.snapshotHash,
      });
      expect(await definitionDoc(connection, WORKFLOW, key)).toMatchObject({
        name: HOSTILE_NAME,
        tenantId: null,
        currentVersion: 1,
      });
      const targetVersions = await versionDocs(connection, WORKFLOW, key);
      expect(targetVersions).toHaveLength(1);
      expect(contentOf(targetVersions[0])).toEqual(sourceContent);
      expect(
        await exportOk(
          world.root,
          inputOf(key, 1, { revision: "r2", changelog: HOSTILE_CHANGELOG }),
        ),
      ).toEqual(flowFile);
    });
  });
});
