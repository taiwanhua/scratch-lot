import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import type { AssigneeSource } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import {
  ASSIGN,
  CREATE_FORM,
  call,
  createDraft,
  definitionOf,
  field,
  ok,
  publishDefinition,
} from "../../forms/test-support/form-fixtures";
import { createRole } from "../../permission/test-support/fixtures";
import {
  BIND,
  FORM_KEY,
  SUBMIT_SUBMISSION,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  audienceRow,
  audienceSource,
  bindForm,
  errorCode,
  errorReason,
  person,
  publishWorkflow,
  rawInstances,
  rawTasks,
  reviewStep,
  setupWorld,
  submitLeave,
  useWorkflow,
} from "../test-support/workflow-fixtures";
import { AudienceSourceService } from "../workflow-engine/audience-source.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

interface IssueResult {
  errors?: { extensions?: Record<string, unknown> }[];
}

/** 以申請人的單據(廚房部)解析一個來源。 */
function resolveFor(
  api: AuthTestApp,
  world: World,
  source: Record<string, unknown>,
  values: Record<string, unknown> = {},
) {
  return api.app
    .get(AudienceSourceService)
    .resolveAudienceSource(source as unknown as AssigneeSource, {
      tenantId: world.tenant,
      orgId: world.kitchen,
      applicantId: world.applicant.userId,
      values,
    });
}

const byText = (a: string, b: string): number => a.localeCompare(b, "zh-Hant");

function problemsOf(result: IssueResult): string[] {
  const issues = result.errors?.[0]?.extensions?.issues;
  return Array.isArray(issues)
    ? issues.map((issue) => String((issue as { problem?: unknown }).problem))
    : [];
}

/** 標題 + 分店欄(引用欄,來源依參數:改版時把使用者引用換成組織引用)。 */
function branchAs(provider: "user" | "org") {
  return definitionOf([
    field("title", "text"),
    field("branch", "reference", {
      source: { provider, labelField: "name" },
    }),
  ]);
}

/** 審核者來源「人員條件」:派給誰、共用流程限制見 workflow-design.test.ts。 */
describe("審核者來源:人員條件", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;
  const nextKey = (prefix: string): string => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_audience", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 0);
  });

  afterAll(async () => {
    await api.close();
  });

  it("「角色 店長 且 所屬組織 = 單據所屬組織」只派給該店店長", async () => {
    const otherStore = await createOrg(world.connection, {
      name: "台中店",
      parentId: world.tenant,
    });
    const shopA = await person(
      api,
      world.connection,
      world.store,
      world.tenant,
    );
    const shopB = await person(api, world.connection, otherStore, world.tenant);
    const shopRole = await createRole(api.app, world.connection, {
      name: "店長",
      ownerOrgId: world.tenant,
      assignTo: [shopA.userId, shopB.userId],
    });
    // 申請人在台北店:單據所屬組織 = 台北店
    const applicant = await person(
      api,
      world.connection,
      world.store,
      world.tenant,
    );
    await useWorkflow(world, nextKey("shop_head"), {
      steps: [
        reviewStep(
          "shop",
          audienceSource(
            audienceRow("role", [shopRole]),
            audienceRow("org", { kind: "dynamic", ref: "submission-org" }),
          ),
        ),
      ],
    });

    const submitted = await submitLeave(world, null, applicant);

    expect(submitted.status).toBe("REVIEWING");
    const [instance] = await rawInstances(world.connection, submitted.id);
    const tasks = await rawTasks(world.connection, String(instance?._id));
    expect(tasks.map((task) => String(task.assigneeId))).toEqual([
      String(shopA.userId),
    ]);
  });

  it("找不到人 → 該關阻擋(沿用既有的阻擋,可新增審核者)", async () => {
    await useWorkflow(world, nextKey("nobody"), {
      steps: [
        reviewStep(
          "nobody",
          audienceSource(audienceRow("permission", ["nobody.approve"])),
        ),
      ],
    });

    const submitted = await submitLeave(world);

    expect(submitted.blocked).toBe(true);
  });

  it("綁定時:表單的組織欄位不是組織引用欄 → FIELD_NOT_ORG_REFERENCE", async () => {
    const key = nextKey("org_field_bind");
    // 沒選檢查用表單:發布時無從對照欄位,只驗格式
    await publishWorkflow(world, key, {
      steps: [
        reviewStep(
          "branch",
          audienceSource(
            audienceRow("org", { kind: "dynamic", ref: "form-field:title" }),
          ),
        ),
      ],
    });

    const bound = await call(api, world.admin.token, BIND, {
      input: { formKey: FORM_KEY, workflowKey: key },
    });

    expect(errorCode(bound)).toBe("VALIDATION_FAILED");
    expect(problemsOf(bound)).toEqual(["FIELD_NOT_ORG_REFERENCE"]);
  });

  it("送出時:提交綁的表單版本裡那個欄位不是組織引用欄 → 流程設定有誤(FIELD_NOT_ORG_REFERENCE)", async () => {
    const formKey = nextKey("org_field_form");
    await ok(api, world.root, CREATE_FORM, {
      input: { key: formKey, moduleKey: WORKFLOW_MODULE, name: "分店單" },
    });
    await publishDefinition(api, world.root, formKey, branchAs("user"), null);
    await ok(api, world.root, ASSIGN, {
      input: { formKey, tenantOrgIds: [String(world.tenant)] },
    });
    // 第 1 版的草稿:branch 還是使用者引用欄
    const oldDraft = await createDraft(api, world.applicant.token, formKey, {
      title: "舊版",
    });
    await publishDefinition(api, world.root, formKey, branchAs("org"), 1);
    const key = nextKey("org_field_submit");
    await publishWorkflow(world, key, {
      steps: [
        reviewStep(
          "branch",
          audienceSource(
            audienceRow("org", { kind: "dynamic", ref: "form-field:branch" }),
          ),
        ),
      ],
    });
    // 綁定時對的是目前版本(第 2 版,組織引用欄)→ 通過
    await bindForm(world, key, formKey);

    const blocked = await call(api, world.applicant.token, SUBMIT_SUBMISSION, {
      input: { id: oldDraft.id, expectedEditVersion: oldDraft.editVersion },
    });

    expect(errorReason(blocked)).toBe("WORKFLOW_MISCONFIGURED");
    expect(problemsOf(blocked)).toEqual(["FIELD_NOT_ORG_REFERENCE"]);
  });

  /**
   * `resolveAudienceSource` 是給程式呼叫的方法(知會對象等「依單據找人」的使用處直接用),
   * GraphQL 上看不到它單獨的行為,所以這兩案經 DI 取服務直接驗(TEST-07 的第二個接縫)。
   */
  describe("resolveAudienceSource", () => {
    it("表單的組織欄位填了組織 → 派給那個組織的人;沒填 → 沒有人", async () => {
      const branch = await createOrg(world.connection, {
        name: "新竹店",
        parentId: world.tenant,
      });
      const clerk = await person(api, world.connection, branch, world.tenant);
      const source = audienceSource(
        audienceRow("org", { kind: "dynamic", ref: "form-field:branch" }),
      );

      const picked = await resolveFor(api, world, source, {
        branch: { id: String(branch) },
      });

      expect(picked.map(String)).toEqual([String(clerk.userId)]);
      expect(await resolveFor(api, world, source, { branch: null })).toEqual(
        [],
      );
    });

    it("租戶 + 含下層 → 租戶裡所有持有該角色的人(含下層組織)", async () => {
      const auditor = await createRole(api.app, world.connection, {
        name: "稽核",
        ownerOrgId: world.tenant,
        assignTo: [world.manager.userId, world.applicant.userId],
      });
      const source = audienceSource(
        audienceRow("role", [auditor]),
        audienceRow("org", { kind: "dynamic", ref: "tenant" }, "descendants"),
      );

      const picked = await resolveFor(api, world, source);

      expect(picked.map(String).toSorted(byText)).toEqual(
        [String(world.manager.userId), String(world.applicant.userId)].toSorted(
          byText,
        ),
      );
      // 只取租戶頂層本身:兩人都在下層組織,沒有人
      expect(
        await resolveFor(
          api,
          world,
          audienceSource(
            audienceRow("role", [auditor]),
            audienceRow("org", { kind: "dynamic", ref: "tenant" }, "self"),
          ),
        ),
      ).toEqual([]);
    });

    it("落盤的來源種類認不得(舊的 users / role)→ 明確丟 ASSIGNEE_KIND_UNKNOWN,不當成沒有人", async () => {
      await expect(
        resolveFor(api, world, {
          kind: "users",
          userIds: [String(world.manager.userId)],
        }),
      ).rejects.toMatchObject({
        extensions: { reason: "ASSIGNEE_KIND_UNKNOWN" },
      });
    });
  });

  it("綁定時:發布版裡有認不得的來源種類(舊資料)→ ASSIGNEE_KIND_UNKNOWN", async () => {
    const key = nextKey("legacy_kind");
    await publishWorkflow(world, key, {
      steps: [reviewStep("boss", { kind: "manager", level: 1 })],
    });
    await world.connection
      .collection("workflow_versions")
      .updateOne(
        { workflowKey: key, version: 1 },
        { $set: { "steps.0.assignee": { kind: "role", roleId: null } } },
      );

    const bound = await call(api, world.admin.token, BIND, {
      input: { formKey: FORM_KEY, workflowKey: key },
    });

    expect(errorCode(bound)).toBe("VALIDATION_FAILED");
    expect(errorReason(bound)).toBe("ASSIGNEE_KIND_UNKNOWN");
  });
});
