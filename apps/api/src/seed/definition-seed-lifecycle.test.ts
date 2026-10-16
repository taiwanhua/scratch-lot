import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type DefinitionSeedSet,
  isDefinitionSeedResultOk,
} from "@repo/domain/seed";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  F,
  FORK_FORM,
  FORMS_MODULES,
  FORM_TEST_TIMEOUT_MS,
  M,
  MODULE_KEY,
  PASSWORD,
  UPDATE_FORM,
  assignForm,
  createOperator,
  createSubmitted,
  definitionOf,
  field,
  getForm,
  getSubmission,
  ok,
  publishDefinition,
  rawSubmission,
  showKey,
} from "../forms/test-support/form-fixtures";
import { createRole } from "../permission/test-support/fixtures";
import { ROOT_ADMIN_ACCOUNT_ENV } from "./seed-operator.service";
import {
  SEED_LOCK_OWNER,
  type SeedTestApp,
  auditCount,
  definitionDoc,
  formSeed,
  holdSeedLock,
  installationsOf,
  persistedStateOf,
  releaseSeedLock,
  runSeed,
  runSeeds,
  seedHashes,
  startSeedTestApp,
  versionDocs,
  workflowSeed,
} from "./test-support/seed-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM = "form-definition";

/** 以另一個帳號當操作者帳號(`ROOT_ADMIN_ACCOUNT`)跑一段,結束後還原。 */
async function asAccount<TResult>(
  account: string | undefined,
  action: () => Promise<TResult>,
): Promise<TResult> {
  // 夾具啟動時一定設了 root 帳號;空字串 = 沒有設定
  const original = process.env[ROOT_ADMIN_ACCOUNT_ENV] ?? "";
  process.env[ROOT_ADMIN_ACCOUNT_ENV] = account ?? "";
  try {
    return await action();
  } finally {
    process.env[ROOT_ADMIN_ACCOUNT_ENV] = original;
  }
}

/**
 * 受管表單的歷史核對、明示退役、既有行為保護(fork、提交、動態權限)、操作者與鎖
 * (`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」)。接縫同 `definition-seed.test.ts`。
 */
describe("受管表單:歷史核對、退役、既有資料保護、操作者與鎖", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let rootOrgId: Types.ObjectId;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-lifecycle");
    ({ api, connection } = app);
    rootOrgId = await findRootOrgId(connection);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  const changedFields = [
    field("title", "text"),
    field("amount", "number", { permission: { show: true, edit: true } }),
    field("memo", "text"),
  ];

  describe("歷史 inspect", () => {
    it("只核對映射與凍結內容:已退役的舊 revision 仍回它的本地版號,不寫入、不改目前版本或名稱", async () => {
      const r1 = formSeed("seed_inspect", "r1");
      const r2 = formSeed("seed_inspect", "r2", {
        name: "改名後的表單",
        fields: changedFields,
      });
      await runSeeds(app, [r1]);
      await runSeeds(app, [r2]);
      const before = await persistedStateOf(connection, FORM, "seed_inspect");

      const result = await runSeeds(app, [r1, r2], "inspect");

      expect(isDefinitionSeedResultOk(result)).toBe(true);
      const form = await definitionDoc(connection, FORM, "seed_inspect");
      expect(result.results).toEqual([
        {
          kind: FORM,
          key: "seed_inspect",
          revision: "r1",
          ...seedHashes(r1),
          definitionId: String(form?._id),
          localVersion: 1,
          outcome: "unchanged",
          conflict: null,
          currentVersion: 2,
          currentContentHash: seedHashes(r2).contentHash,
        },
        {
          kind: FORM,
          key: "seed_inspect",
          revision: "r2",
          ...seedHashes(r2),
          definitionId: String(form?._id),
          localVersion: 2,
          outcome: "unchanged",
          conflict: null,
          currentVersion: 2,
          currentContentHash: seedHashes(r2).contentHash,
        },
      ]);
      expect(await persistedStateOf(connection, FORM, "seed_inspect")).toEqual(
        before,
      );
    });

    it("尚未安裝的 revision 回 absent(不是錯誤、也不是完成),並附目前版本;inspect 不會順手安裝", async () => {
      const r1 = formSeed("seed_absent", "r1");
      await runSeeds(app, [r1]);

      const result = await runSeeds(
        app,
        [
          formSeed("seed_absent", "r9", { fields: changedFields }),
          formSeed("seed_never", "r1"),
        ],
        "inspect",
      );

      expect(isDefinitionSeedResultOk(result)).toBe(true);
      expect(result.results).toMatchObject([
        {
          revision: "r9",
          outcome: "absent",
          localVersion: null,
          currentVersion: 1,
          currentContentHash: seedHashes(r1).contentHash,
        },
        {
          key: "seed_never",
          outcome: "absent",
          definitionId: null,
          localVersion: null,
          currentVersion: null,
          currentContentHash: null,
        },
      ]);
      expect(await definitionDoc(connection, FORM, "seed_never")).toBeNull();
      expect(await installationsOf(connection, "seed_never")).toEqual([]);
    });

    it("同 revision 的內容與已登記的不同、或凍結內容被改過:回衝突", async () => {
      const r1 = formSeed("seed_inspect_bad", "r1");
      await runSeeds(app, [r1]);

      const changed = await runSeed(
        app,
        formSeed("seed_inspect_bad", "r1", { fields: changedFields }),
        "inspect",
      );
      await connection
        .collection("form_versions")
        .updateOne(
          { formKey: "seed_inspect_bad", version: 1 },
          { $set: { "fields.0.label": "被改過的凍結內容" } },
        );
      const tampered = await runSeed(app, r1, "inspect");

      expect(changed.conflict?.code).toBe("REVISION_HASH_MISMATCH");
      expect(tampered.conflict?.code).toBe("CONTENT_MISMATCH");
    });
  });

  describe("明示退役", () => {
    it("內容相符的目前版本照本地版號退役;重跑不重複退役;之後要重新發布即使內容相同也是新 revision、新版號", async () => {
      const r1 = formSeed("seed_retire", "r1");
      const r2 = formSeed("seed_retire", "r2", { desiredStatus: "retired" });
      const r3 = formSeed("seed_retire", "r3");
      expect(seedHashes(r2).contentHash).toBe(seedHashes(r1).contentHash);
      await runSeeds(app, [r1]);

      const retired = await runSeed(app, r2);

      expect(retired).toMatchObject({ outcome: "updated", localVersion: 1 });
      expect(
        await definitionDoc(connection, FORM, "seed_retire"),
      ).toMatchObject({ currentVersion: null });
      const retireAudits = { action: "form-version.retire" };
      const auditsAfterRetire = await auditCount(connection, retireAudits);
      const stateAfterRetire = await persistedStateOf(
        connection,
        FORM,
        "seed_retire",
      );

      const rerun = await runSeed(app, r2);

      expect(rerun).toMatchObject({ outcome: "unchanged", localVersion: 1 });
      expect(await auditCount(connection, retireAudits)).toBe(
        auditsAfterRetire,
      );
      expect(await persistedStateOf(connection, FORM, "seed_retire")).toEqual(
        stateAfterRetire,
      );

      // 不用舊內容復活已退役版:r3 內容相同,仍發一個新的正式版號
      const republished = await runSeed(app, r3);

      expect(republished).toMatchObject({
        outcome: "updated",
        localVersion: 2,
        contentHash: seedHashes(r1).contentHash,
      });
      const versions = await versionDocs(connection, FORM, "seed_retire");
      expect(
        versions.map(({ version, status }) => ({ version, status })),
      ).toEqual([
        { version: 1, status: "retired" },
        { version: 2, status: "published" },
      ]);
    });

    it("空環境裡仍登記的退役宣告:建立版本後退役,最終沒有目前版本", async () => {
      const seed = formSeed("seed_retire_new", "r1", {
        desiredStatus: "retired",
      });

      const result = await runSeed(app, seed);

      expect(result).toMatchObject({ outcome: "created", localVersion: 1 });
      expect(
        await definitionDoc(connection, FORM, "seed_retire_new"),
      ).toMatchObject({ currentVersion: null });
      const [version] = await versionDocs(connection, FORM, "seed_retire_new");
      expect(version).toMatchObject({ version: 1, status: "retired" });
      const rerun = await runSeed(app, seed);
      expect(rerun.outcome).toBe("unchanged");
    });

    it("退役之後畫面另外發布了新版:重跑退役宣告衝突,不退役別人的新版", async () => {
      const r2 = formSeed("seed_retire_drift", "r2", {
        desiredStatus: "retired",
      });
      await runSeeds(app, [formSeed("seed_retire_drift", "r1")]);
      await runSeeds(app, [r2]);
      await publishDefinition(
        api,
        app.root,
        "seed_retire_drift",
        definitionOf(changedFields),
        1,
      );

      const rerun = await runSeed(app, r2);

      expect(rerun.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
      expect(
        await definitionDoc(connection, FORM, "seed_retire_drift"),
      ).toMatchObject({ currentVersion: 2 });
    });
  });

  describe("既有行為保護", () => {
    it("改版不動租戶的分派、fork 與既有提交;同 key 欄位的動態權限沿用同一筆;新提交才綁新版", async () => {
      const r1 = formSeed("seed_guard", "r1");
      await runSeeds(app, [r1]);
      const tenant = await createOrg(connection, { name: "受管表單租戶" });
      await assignForm(api, app.root, "seed_guard", [tenant]);
      const member = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [M.all, F.all, showKey("seed_guard", "amount")],
        moduleKeys: [MODULE_KEY, ...FORMS_MODULES],
      });
      await ok(api, member.token, FORK_FORM, {
        input: {
          sourceKey: "seed_guard",
          sourceVersion: 1,
          key: "seed_guard_tenant",
          name: "租戶客製",
        },
      });
      const submitted = await createSubmitted(api, member.token, "seed_guard", {
        title: "改版前送出的單",
        amount: 5,
      });
      const forkBefore = await persistedStateOf(
        connection,
        FORM,
        "seed_guard_tenant",
      );
      const permissionBefore = await connection
        .collection("permissions")
        .findOne({ key: showKey("seed_guard", "amount") });
      const rawBefore = await rawSubmission(connection, submitted.id);

      const result = await runSeed(
        app,
        formSeed("seed_guard", "r2", { fields: changedFields }),
      );

      expect(result).toMatchObject({ outcome: "updated", localVersion: 2 });
      // fork 是獨立的定義,不自動追蹤
      const forkAfter = await persistedStateOf(
        connection,
        FORM,
        "seed_guard_tenant",
      );
      expect(forkAfter).toMatchObject({
        definition: (forkBefore as { definition: unknown }).definition,
        versions: (forkBefore as { versions: unknown }).versions,
      });
      // 分派還在、既有提交仍綁原版且內容不變
      const form = await getForm(api, app.root, "seed_guard");
      expect(form.assignments).toEqual([
        { tenantOrgId: String(tenant), enabled: true },
      ]);
      expect(await rawSubmission(connection, submitted.id)).toEqual(rawBefore);
      const reread = await getSubmission(api, member.token, submitted.id);
      expect(reread).toMatchObject({
        version: 1,
        status: submitted.status,
        values: submitted.values,
        revisions: submitted.revisions,
      });
      // 同 key 欄位的權限沿用同一筆(角色的授予跟著留下)
      const permissionAfter = await connection
        .collection("permissions")
        .findOne({ key: showKey("seed_guard", "amount") });
      expect(permissionAfter?._id).toEqual(permissionBefore?._id);
      // 新提交綁新版
      const next = await createSubmitted(api, member.token, "seed_guard", {
        title: "改版後送出的單",
        amount: 7,
      });
      expect(next.version).toBe(2);
    });

    it("名稱是條件更新:比對之後、寫入之前畫面改了名字 → 不覆蓋畫面的值,也不往下發版", async () => {
      await runSeeds(app, [formSeed("seed_cas", "r1")]);
      const r2 = formSeed("seed_cas", "r2", {
        name: "宣告的新名字",
        fields: changedFields,
      });
      const reached = app.hooks.reached.bind(app.hooks);
      jest
        .spyOn(app.hooks, "reached")
        .mockImplementation(async (checkpoint) => {
          if (checkpoint === "update-metadata") {
            await ok(api, app.root, UPDATE_FORM, {
              input: { key: "seed_cas", name: "畫面剛改的名字" },
            });
          }
          return reached(checkpoint);
        });

      const raced = await runSeeds(app, [r2]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([
        { code: "APPLY_FAILED", key: "seed_cas" },
      ]);
      const form = await getForm(api, app.root, "seed_cas");
      expect(form).toMatchObject({
        name: "畫面剛改的名字",
        currentVersion: 1,
        hasDraft: false,
      });
      // 之後重跑看到的是現場漂移,由操作者整理
      const rerun = await runSeed(app, r2);
      expect(rerun.conflict?.code).toBe("METADATA_DRIFT");
      expect(await versionDocs(connection, FORM, "seed_cas")).toHaveLength(1);
    });

    it("同 key 是租戶的客製表單:衝突,不接管租戶的定義", async () => {
      await runSeeds(app, [formSeed("seed_fork_source", "r1")]);
      const tenant = await createOrg(connection, { name: "客製表單租戶" });
      await assignForm(api, app.root, "seed_fork_source", [tenant]);
      const member = await createOperator(api, connection, {
        orgId: tenant,
        permissionKeys: [F.all],
        moduleKeys: FORMS_MODULES,
      });
      await ok(api, member.token, FORK_FORM, {
        input: {
          sourceKey: "seed_fork_source",
          sourceVersion: 1,
          key: "seed_tenant_owned",
          name: "租戶的",
        },
      });
      const before = await persistedStateOf(
        connection,
        FORM,
        "seed_tenant_owned",
      );

      const result = await runSeed(app, formSeed("seed_tenant_owned", "r1"));

      expect(result.conflict?.code).toBe("OWNER_MISMATCH");
      expect(
        await persistedStateOf(connection, FORM, "seed_tenant_owned"),
      ).toEqual(before);
    });
  });

  describe("操作者:該環境真實的 root 管理員", () => {
    let sequence = 0;

    async function account(options: {
      orgId: Types.ObjectId;
      roleOwnerOrgId: Types.ObjectId;
      permissionKeys: string[];
      moduleKeys: string[];
      enabled?: boolean;
    }): Promise<string> {
      sequence += 1;
      const name = `seed-operator-${String(sequence)}`;
      const userId = await createUser(connection, {
        account: name,
        password: PASSWORD,
        orgIds: [options.orgId],
        enabled: options.enabled ?? true,
      });
      await createRole(api.app, connection, {
        name: `安裝測試角色 ${name}`,
        ownerOrgId: options.roleOwnerOrgId,
        moduleKeys: options.moduleKeys,
        permissionKeys: options.permissionKeys,
        assignTo: [userId],
      });
      return name;
    }

    /** 被拒的請求:整份停在任何寫入之前。 */
    async function expectRejected(
      operatorAccount: string | undefined,
      code: string,
      seed: DefinitionSeedSet = formSeed(
        `seed_operator_${String(sequence)}`,
        "r1",
      ),
    ): Promise<string> {
      const auditsBefore = await auditCount(connection);
      const result = await asAccount(operatorAccount, () =>
        runSeeds(app, [seed]),
      );
      expect(result.results).toEqual([]);
      expect(result.errors).toMatchObject([{ code }]);
      expect(isDefinitionSeedResultOk(result)).toBe(false);
      expect(await definitionDoc(connection, seed.kind, seed.key)).toBeNull();
      expect(await installationsOf(connection, seed.key)).toEqual([]);
      expect(await auditCount(connection)).toBe(auditsBefore);
      return result.errors[0]?.message ?? "";
    }

    it("沒有設定帳號、帳號不存在:在發布前停止,不建假操作者", async () => {
      await expectRejected(undefined, "OPERATOR_UNAVAILABLE");
      await expectRejected("no-such-account", "OPERATOR_UNAVAILABLE");
      // 沒有憑空多出帳號
      expect(
        await connection
          .collection("users")
          .countDocuments({ account: "no-such-account" }),
      ).toBe(0);
    });

    it("帳號已停用:拒絕,不替它重新啟用", async () => {
      const disabled = await account({
        orgId: rootOrgId,
        roleOwnerOrgId: rootOrgId,
        permissionKeys: [F.all],
        moduleKeys: FORMS_MODULES,
        enabled: false,
      });

      await expectRejected(disabled, "OPERATOR_DISABLED");

      expect(
        await connection.collection("users").findOne({ account: disabled }),
      ).toMatchObject({ enabled: false });
    });

    it("帳號不是根組織成員(登入線會退回它所屬的租戶):拒絕,不因為指名了根組織就當成站在根組織", async () => {
      const tenant = await createOrg(connection, { name: "操作者所在租戶" });
      const tenantAdmin = await account({
        orgId: tenant,
        roleOwnerOrgId: tenant,
        permissionKeys: [F.all],
        moduleKeys: FORMS_MODULES,
      });

      await expectRejected(tenantAdmin, "OPERATOR_NOT_ROOT");
    });

    it("站在根組織但管理範圍不是全部(角色的擁有組織是某個租戶):拒絕", async () => {
      const tenant = await createOrg(connection, { name: "角色擁有租戶" });
      const limited = await account({
        orgId: rootOrgId,
        roleOwnerOrgId: tenant,
        permissionKeys: [F.all],
        moduleKeys: FORMS_MODULES,
      });

      await expectRejected(limited, "OPERATOR_NOT_ROOT");
    });

    it("真實 root 成員但缺少這次會用到的權限:逐項列出缺的權限;退役也要 edit / publish", async () => {
      const viewer = await account({
        orgId: rootOrgId,
        roleOwnerOrgId: rootOrgId,
        permissionKeys: [F.view, F.create, "system.workflows.view"],
        moduleKeys: [...FORMS_MODULES, "system.workflows"],
      });

      const formMessage = await expectRejected(viewer, "OPERATOR_FORBIDDEN");
      const retireMessage = await expectRejected(
        viewer,
        "OPERATOR_FORBIDDEN",
        formSeed("seed_operator_retire", "r1", { desiredStatus: "retired" }),
      );
      const workflowMessage = await expectRejected(
        viewer,
        "OPERATOR_FORBIDDEN",
        workflowSeed("seed_operator_flow", "r1"),
      );

      expect(formMessage).toContain(F.edit);
      expect(formMessage).not.toContain(F.create);
      expect(retireMessage).toContain(F.edit);
      for (const key of ["create", "edit", "publish"]) {
        expect(workflowMessage).toContain(`system.workflows.${key}`);
      }
    });

    it("權限齊全的 root 成員可以安裝;稽核記在他名下", async () => {
      const operator = await account({
        orgId: rootOrgId,
        roleOwnerOrgId: rootOrgId,
        permissionKeys: [F.all],
        moduleKeys: FORMS_MODULES,
      });
      const seed = formSeed("seed_operator_ok", "r1");

      const result = await asAccount(operator, () => runSeed(app, seed));

      expect(result.outcome).toBe("created");
      const user = await connection
        .collection("users")
        .findOne({ account: operator });
      const form = await definitionDoc(connection, FORM, "seed_operator_ok");
      expect(form?.createdBy).toEqual(user?._id);
      expect(
        await auditCount(connection, {
          action: "form.create",
          targetId: form?._id,
          actorId: user?._id,
        }),
      ).toBe(1);
      // 換回 root 帳號後照常可用(root 帳號與它的角色沒有被動到)
      const asRoot = await runSeed(app, seed);
      expect(asRoot.outcome).toBe("unchanged");
    });
  });

  describe("共用互斥鎖:只核對 owner,不搶鎖", () => {
    afterEach(async () => {
      await holdSeedLock(connection);
    });

    it("沒有人持鎖、或 owner 不是請求帶來的:拒絕,零寫入,也不會自己建鎖", async () => {
      const seed = formSeed("seed_lock", "r1");
      await releaseSeedLock(connection);

      const unlocked = await runSeeds(app, [seed]);

      expect(unlocked.errors).toMatchObject([{ code: "LOCK_NOT_HELD" }]);
      expect(
        await connection.collection("changelog_lock").countDocuments(),
      ).toBe(0);

      await holdSeedLock(connection, "someone-else");
      const foreign = await runSeeds(app, [seed]);
      const foreignInspect = await runSeeds(app, [seed], "inspect");

      expect(foreign.errors).toMatchObject([{ code: "LOCK_OWNER_MISMATCH" }]);
      expect(foreignInspect.errors).toMatchObject([
        { code: "LOCK_OWNER_MISMATCH" },
      ]);
      expect(await definitionDoc(connection, FORM, "seed_lock")).toBeNull();
      expect(await installationsOf(connection, "seed_lock")).toEqual([]);
      // 鎖原封不動(沒有被接管、改寫或釋放)
      expect(
        await connection.collection("changelog_lock").findOne({}),
      ).toMatchObject({ owner: "someone-else" });
    });

    it("每一筆之前再核對一次:鎖在途中換手,後面的宣告不再寫入", async () => {
      const first = formSeed("seed_lock_first", "r1");
      const second = formSeed("seed_lock_second", "r1");
      const reached = app.hooks.reached.bind(app.hooks);
      jest
        .spyOn(app.hooks, "reached")
        .mockImplementation(async (checkpoint) => {
          if (checkpoint === "record-installed") {
            await holdSeedLock(connection, "took-over");
          }
          return reached(checkpoint);
        });

      const result = await runSeeds(app, [first, second]);

      expect(result.results).toMatchObject([
        { key: "seed_lock_first", outcome: "created" },
      ]);
      expect(result.errors).toMatchObject([
        { code: "LOCK_OWNER_MISMATCH", key: "seed_lock_second" },
      ]);
      expect(
        await definitionDoc(connection, FORM, "seed_lock_second"),
      ).toBeNull();
      expect(SEED_LOCK_OWNER).not.toBe("took-over");
    });
  });
});
