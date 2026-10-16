import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection } from "mongoose";

import { isDefinitionSeedResultOk } from "@repo/domain/seed";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import { findRootOrgId } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  FORM_TEST_TIMEOUT_MS,
  MODULE_KEY,
  UPDATE_FORM,
  definitionOf,
  field,
  getForm,
  ok,
  publishDefinition,
  publishNewForm,
  showKey,
} from "../forms/test-support/form-fixtures";
import {
  SEED_FIELDS,
  SEED_RUN_ID,
  type SeedTestApp,
  auditActionsOf,
  auditCount,
  definitionDoc,
  formSeed,
  installationOf,
  installationsOf,
  persistedStateOf,
  runSeed,
  runSeeds,
  seedHashes,
  startSeedTestApp,
  versionDocs,
} from "./test-support/seed-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM = "form-definition";

/**
 * 受管表單的安裝(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):真 Nest app、真 MongoDB;
 * 畫面上的操作走真的 `/graphql`,安裝走程序介面 `DefinitionSeedService`(TEST-07 的第二個接縫)。
 * 每個中斷點的續跑在 `definition-seed-resume.test.ts`,流程在 `definition-seed-workflow.test.ts`。
 */
describe("受管表單:安裝、重跑、採納、改版與衝突", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-forms");
    ({ api, connection } = app);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  const changedFields = [
    field("title", "text"),
    field("amount", "number", {
      label: "內部金額",
      permission: { show: true, edit: true },
    }),
    field("memo", "text"),
  ];

  describe("首次安裝與重跑", () => {
    it("空環境首次安裝:以原服務建身分、草稿、存檔、發布;結果帶本環境的 id 與版號,稽核的操作者是真實的 root", async () => {
      const seed = formSeed("seed_first", "r1", {
        tabLabelTemplate: "{{title}}",
      });
      const result = await runSeeds(app, [seed]);

      expect(isDefinitionSeedResultOk(result)).toBe(true);
      const form = await definitionDoc(connection, FORM, "seed_first");
      expect(result.results).toEqual([
        {
          kind: FORM,
          key: "seed_first",
          revision: "r1",
          ...seedHashes(seed),
          definitionId: String(form?._id),
          localVersion: 1,
          outcome: "created",
          conflict: null,
        },
      ]);
      expect(form).toMatchObject({
        name: seed.name,
        moduleKey: MODULE_KEY,
        ownerOrgId: null,
        currentVersion: 1,
        tabLabelTemplate: "{{title}}",
        createdBy: app.rootUserId,
      });
      const [version, ...rest] = await versionDocs(
        connection,
        FORM,
        "seed_first",
      );
      expect(rest).toEqual([]);
      expect(version).toMatchObject({
        version: 1,
        status: "published",
        changelog: "發布 r1",
        publishedBy: app.rootUserId,
        fields: seed.definition.fields,
      });
      // 動態權限照原發布建立
      const permission = await connection
        .collection("permissions")
        .findOne({ key: showKey("seed_first", "amount") });
      expect(permission).toMatchObject({ source: "dynamic", retiredAt: null });
      // 稽核沿用原服務,操作者是 root 帳號、組織是根組織
      if (!form || !version) {
        throw new Error("安裝後找不到表單或版本");
      }
      expect(await auditActionsOf(connection, [form._id, version._id])).toEqual(
        [
          "form.create",
          "form.update",
          "form-version.create-draft",
          "form-version.save-draft",
          "form-version.publish",
        ],
      );
      const audits = await connection
        .collection("audit_logs")
        .find({ targetId: { $in: [form._id, version._id] } })
        .toArray();
      const rootOrgId = await findRootOrgId(connection);
      for (const audit of audits) {
        expect(audit.actorId).toEqual(app.rootUserId);
        expect(audit.orgId).toEqual(rootOrgId);
      }
      // 安裝紀錄:預配置的 id 就是實體的 id,檢查點依序記下
      const installation = await installationOf(connection, seed);
      expect(installation).toMatchObject({
        ...seedHashes(seed),
        status: "installed",
        step: "installed",
        mode: "created",
        localVersion: 1,
        runId: SEED_RUN_ID,
        desiredStatus: "published",
        metadata: {
          name: seed.name,
          moduleKey: MODULE_KEY,
          tabLabelTemplate: "{{title}}",
        },
        expected: {
          definitionExists: false,
          currentVersion: null,
          metadata: null,
        },
      });
      expect(installation?.definitionId).toEqual(form._id);
      expect(installation?.draftId).toEqual(version._id);
      expect(installation?.checkpoints.map(({ step }) => step)).toEqual([
        "reserved",
        "identity",
        "metadata",
        "draft",
        "saved",
        "published",
        "installed",
      ]);
      // 畫面上看到的就是一張已發布的共用表單
      expect(await getForm(api, app.root, "seed_first")).toMatchObject({
        isShared: true,
        currentVersion: 1,
        hasDraft: false,
      });
    });

    it("重跑未變:不增版、不改身分,身分 / 版本 / 安裝紀錄逐欄不變(含時間),沒有新增稽核", async () => {
      const seed = formSeed("seed_rerun", "r1");
      await runSeeds(app, [seed]);
      const before = await persistedStateOf(connection, FORM, "seed_rerun");

      const result = await runSeeds(app, [seed], "apply", {
        runId: "another-run",
      });

      expect(result.errors).toEqual([]);
      expect(result.results[0]).toMatchObject({
        outcome: "unchanged",
        localVersion: 1,
      });
      expect(await persistedStateOf(connection, FORM, "seed_rerun")).toEqual(
        before,
      );
    });

    it("已記成功仍核對實體:版本被拿掉後重跑不會只看紀錄就當成功", async () => {
      const seed = formSeed("seed_verify", "r1");
      await runSeeds(app, [seed]);
      await connection
        .collection("form_versions")
        .deleteMany({ formKey: "seed_verify" });

      const result = await runSeeds(app, [seed]);

      expect(result.results[0]?.conflict?.code).toBe("VERSION_MISSING");
      expect(result.results[0]?.outcome).toBeNull();
    });
  });

  describe("來源環境採納", () => {
    it("畫面先發布相同內容:採納該版,保留 id 與版號,不另發一版、不寫稽核", async () => {
      const seed = formSeed("seed_adopt", "r1");
      const published = await publishNewForm(
        api,
        app.root,
        "seed_adopt",
        seed.definition,
        seed.name,
      );
      const auditsBefore = await auditCount(connection);
      const versionsBefore = await versionDocs(connection, FORM, "seed_adopt");
      const uiForm = await getForm(api, app.root, "seed_adopt");

      const result = await runSeeds(app, [seed]);

      expect(result.errors).toEqual([]);
      expect(result.results[0]).toMatchObject({
        outcome: "adopted",
        definitionId: uiForm.id,
        localVersion: published.version,
      });
      expect(await versionDocs(connection, FORM, "seed_adopt")).toEqual(
        versionsBefore,
      );
      expect(await auditCount(connection)).toBe(auditsBefore);
      expect(await installationOf(connection, seed)).toMatchObject({
        status: "installed",
        mode: "adopted",
        draftId: null,
        localVersion: 1,
      });
      // 之後就是受管定義:重跑未變
      const rerun = await runSeed(app, seed);
      expect(rerun.outcome).toBe("unchanged");
    });

    it("初次納管的同 key 內容不同:衝突,不套自動認養,現場不動", async () => {
      await publishNewForm(
        api,
        app.root,
        "seed_unmanaged",
        definitionOf([field("title", "text"), field("other", "text")]),
      );
      const before = await persistedStateOf(connection, FORM, "seed_unmanaged");

      const result = await runSeeds(app, [formSeed("seed_unmanaged", "r1")]);

      expect(result.results[0]?.conflict?.code).toBe("UNMANAGED_DEFINITION");
      expect(
        await persistedStateOf(connection, FORM, "seed_unmanaged"),
      ).toEqual(before);
    });

    it("同 key 掛在別的模組:衝突(模組建立後不可改)", async () => {
      await ok(api, app.root, CREATE_FORM, {
        input: { key: "seed_module", moduleKey: "demo.form", name: "別的模組" },
      });

      const result = await runSeeds(app, [formSeed("seed_module", "r1")]);

      expect(result.results[0]?.conflict?.code).toBe("MODULE_MISMATCH");
      expect(await installationsOf(connection, "seed_module")).toEqual([]);
    });
  });

  describe("改版", () => {
    it("正常新版:沿用原生命週期發布下一版,前一版退役、權限同步、名稱以條件更新;舊紀錄保留", async () => {
      const r1 = formSeed("seed_next", "r1");
      const r2 = formSeed("seed_next", "r2", {
        name: "受管表單(改名)",
        tabLabelTemplate: "{{title}}",
        fields: changedFields,
      });
      const first = await runSeeds(app, [r1]);

      const second = await runSeeds(app, [r2]);

      expect(second.errors).toEqual([]);
      expect(second.results[0]).toMatchObject({
        outcome: "updated",
        definitionId: first.results[0]?.definitionId,
        localVersion: 2,
        contentHash: seedHashes(r2).contentHash,
      });
      expect(await definitionDoc(connection, FORM, "seed_next")).toMatchObject({
        name: "受管表單(改名)",
        tabLabelTemplate: "{{title}}",
        currentVersion: 2,
      });
      const versions = await versionDocs(connection, FORM, "seed_next");
      expect(
        versions.map(({ version, status }) => ({ version, status })),
      ).toEqual([
        { version: 1, status: "retired" },
        { version: 2, status: "published" },
      ]);
      // 同 key 欄位的權限沿用同一筆、名稱跟著新的表單名與 label;新宣告的建立
      const permissions = await connection
        .collection("permissions")
        .find<{ key: string; name: string }>({ key: { $regex: "-seed_next-" } })
        .sort({ key: 1 })
        .toArray();
      expect(permissions.map(({ key, name }) => ({ key, name }))).toEqual([
        {
          key: `${MODULE_KEY}.edit-seed_next-amount`,
          name: "受管表單(改名) / 內部金額 可改",
        },
        {
          key: showKey("seed_next", "amount"),
          name: "受管表單(改名) / 內部金額 可見",
        },
      ]);
      const installations = await installationsOf(connection, "seed_next");
      expect(
        installations.map(({ revision, status, mode, localVersion }) => ({
          revision,
          status,
          mode,
          localVersion,
        })),
      ).toEqual([
        {
          revision: "r1",
          status: "installed",
          mode: "created",
          localVersion: 1,
        },
        {
          revision: "r2",
          status: "installed",
          mode: "updated",
          localVersion: 2,
        },
      ]);
      expect(installations[1]?.expected).toEqual({
        definitionExists: true,
        currentVersion: 1,
        metadata: { name: r1.name, tabLabelTemplate: null, allowDraft: true },
      });
      const rerun = await runSeed(app, r2);
      expect(rerun.outcome).toBe("unchanged");
    });

    it("目前內容已等於要交付的來源版本:畫面在受管表單上發布了新版,匯出登記後採納,不再發一版", async () => {
      const r1 = formSeed("seed_source", "r1");
      await runSeeds(app, [r1]);
      await publishDefinition(
        api,
        app.root,
        "seed_source",
        definitionOf(changedFields),
        1,
      );

      const result = await runSeeds(app, [
        formSeed("seed_source", "r2", { fields: changedFields }),
      ]);

      expect(result.results[0]).toMatchObject({
        outcome: "adopted",
        localVersion: 2,
      });
      expect(await versionDocs(connection, FORM, "seed_source")).toHaveLength(
        2,
      );
    });

    it("移除宣告後重新登記:歷史紀錄不奪回現場內容;現場改過就衝突,內容相同才採納", async () => {
      const r1 = formSeed("seed_relist", "r1");
      await runSeeds(app, [r1]);
      // 宣告移出 registry 的期間(安裝不會收到它),畫面另外發布了新版
      await publishDefinition(
        api,
        app.root,
        "seed_relist",
        definitionOf(changedFields),
        1,
      );
      const before = await persistedStateOf(connection, FORM, "seed_relist");

      // 原 revision 重新登記:目前版本已不是它
      const again = await runSeeds(app, [r1]);
      expect(again.results[0]?.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
      // 換新 revision 但內容與現場不同:現場漂移
      const drift = await runSeeds(app, [
        formSeed("seed_relist", "r2", {
          fields: [field("title", "text"), field("else", "text")],
        }),
      ]);
      expect(drift.results[0]?.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
      expect(await persistedStateOf(connection, FORM, "seed_relist")).toEqual(
        before,
      );

      // 內容等於現場目前版本:採納
      const adopted = await runSeeds(app, [
        formSeed("seed_relist", "r3", { fields: changedFields }),
      ]);
      expect(adopted.results[0]).toMatchObject({
        outcome: "adopted",
        localVersion: 2,
      });
    });
  });

  describe("漂移與衝突(零寫入)", () => {
    it("同一個 revision 內容不同:衝突,revision 不可改內容", async () => {
      await runSeeds(app, [formSeed("seed_hash", "r1")]);
      const before = await persistedStateOf(connection, FORM, "seed_hash");

      const result = await runSeeds(app, [
        formSeed("seed_hash", "r1", { changelog: "偷改說明" }),
      ]);

      expect(result.results[0]?.conflict?.code).toBe("REVISION_HASH_MISMATCH");
      expect(await persistedStateOf(connection, FORM, "seed_hash")).toEqual(
        before,
      );
    });

    it("受管表單上有畫面開的草稿:發新版、內容未變的重跑、照目前版本退役都先報衝突,草稿不丟;純 inspect 照常", async () => {
      const r1 = formSeed("seed_draft", "r1");
      await runSeeds(app, [r1]);
      await ok(api, app.root, CREATE_DRAFT, {
        input: { formKey: "seed_draft", baseVersion: 1 },
      });
      const before = await persistedStateOf(connection, FORM, "seed_draft");

      const next = await runSeed(
        app,
        formSeed("seed_draft", "r2", { fields: changedFields }),
      );
      const rerun = await runSeed(app, r1);
      const retire = await runSeed(
        app,
        formSeed("seed_draft", "r3", { desiredStatus: "retired" }),
      );
      const inspected = await runSeed(app, r1, "inspect");

      expect(next.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(rerun.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(retire.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(inspected).toMatchObject({
        outcome: "unchanged",
        localVersion: 1,
      });
      // 草稿、目前版本、安裝紀錄都沒被動到(沒有被退役,也沒有多登記 revision)
      expect(await persistedStateOf(connection, FORM, "seed_draft")).toEqual(
        before,
      );
      const form = await getForm(api, app.root, "seed_draft");
      expect(form).toMatchObject({ hasDraft: true, currentVersion: 1 });
    });

    it("名稱在畫面上被改過:重跑與改版都衝突,不覆蓋現場的值", async () => {
      const r1 = formSeed("seed_meta", "r1");
      await runSeeds(app, [r1]);
      await ok(api, app.root, UPDATE_FORM, {
        input: { key: "seed_meta", name: "現場改的名字" },
      });

      const rerun = await runSeeds(app, [r1]);
      const next = await runSeeds(app, [
        formSeed("seed_meta", "r2", { fields: changedFields }),
      ]);

      expect(rerun.results[0]?.conflict?.code).toBe("METADATA_DRIFT");
      expect(next.results[0]?.conflict?.code).toBe("METADATA_DRIFT");
      const form = await getForm(api, app.root, "seed_meta");
      expect(form.name).toBe("現場改的名字");
      expect(await versionDocs(connection, FORM, "seed_meta")).toHaveLength(1);
    });

    it("允許存草稿:宣告關掉 → 安裝出來的表單是關的,快照記下;重跑未變;現場切回開 → METADATA_DRIFT", async () => {
      const r1 = formSeed("seed_allow_draft", "r1", { allowDraft: false });
      const created = await runSeed(app, r1);

      expect(created).toMatchObject({ outcome: "created", conflict: null });
      expect(
        await definitionDoc(connection, FORM, "seed_allow_draft"),
      ).toMatchObject({ allowDraft: false });
      const installation = await installationOf(connection, r1);
      expect(installation?.metadata).toMatchObject({ allowDraft: false });
      const rerun = await runSeed(app, r1);
      expect(rerun.conflict).toBeNull();

      await ok(api, app.root, UPDATE_FORM, {
        input: { key: "seed_allow_draft", allowDraft: true },
      });
      const drifted = await runSeeds(app, [r1]);
      expect(drifted.results[0]?.conflict?.code).toBe("METADATA_DRIFT");
      expect(
        await definitionDoc(connection, FORM, "seed_allow_draft"),
      ).toMatchObject({ allowDraft: true });
    });

    it("允許存草稿沒變:改版的 metadata 更新不帶它(舊表單不寫進顯式 true,稽核不記)", async () => {
      const r1 = formSeed("seed_allow_draft_same", "r1");
      await runSeeds(app, [r1]);
      // 這個設定之前建的表單:沒有 allowDraft 欄位
      await connection
        .collection("forms")
        .updateOne(
          { key: "seed_allow_draft_same" },
          { $unset: { allowDraft: "" } },
        );
      const form = await definitionDoc(
        connection,
        FORM,
        "seed_allow_draft_same",
      );

      const next = await runSeed(
        app,
        formSeed("seed_allow_draft_same", "r2", {
          name: "改名後",
          fields: changedFields,
        }),
      );

      expect(next.conflict).toBeNull();
      const after = await definitionDoc(
        connection,
        FORM,
        "seed_allow_draft_same",
      );
      expect(after?.name).toBe("改名後");
      expect(after).not.toHaveProperty("allowDraft");
      const audits = await connection
        .collection("audit_logs")
        .find({ action: "form.update", targetId: form?._id })
        .toArray();
      expect(audits.length).toBeGreaterThan(0);
      for (const audit of audits) {
        expect(audit.after).not.toHaveProperty("allowDraft");
      }
    });

    it("允許存草稿:沒宣告 = 開;改版宣告關掉 → 以條件更新改成關", async () => {
      const r1 = formSeed("seed_allow_draft_next", "r1");
      await runSeeds(app, [r1]);
      const before = await definitionDoc(
        connection,
        FORM,
        "seed_allow_draft_next",
      );
      expect(before?.allowDraft).not.toBe(false);

      const r2 = formSeed("seed_allow_draft_next", "r2", {
        allowDraft: false,
        fields: changedFields,
      });
      const next = await runSeed(app, r2);

      expect(next.conflict).toBeNull();
      expect(
        await definitionDoc(connection, FORM, "seed_allow_draft_next"),
      ).toMatchObject({ allowDraft: false, currentVersion: 2 });
    });

    it("整批預檢:同批任一筆衝突就整批不寫,其他宣告也不會被安裝", async () => {
      await runSeeds(app, [formSeed("seed_batch_b", "r1")]);
      const auditsBefore = await auditCount(connection);

      const result = await runSeeds(app, [
        formSeed("seed_batch_a", "r1"),
        formSeed("seed_batch_b", "r1", { fields: SEED_FIELDS, name: "改了" }),
      ]);

      expect(isDefinitionSeedResultOk(result)).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        key: "seed_batch_b",
        conflict: { code: "REVISION_HASH_MISMATCH" },
      });
      expect(await definitionDoc(connection, FORM, "seed_batch_a")).toBeNull();
      expect(await installationsOf(connection, "seed_batch_a")).toEqual([]);
      expect(await auditCount(connection)).toBe(auditsBefore);
    });

    it("定義檢查不通過(模組不存在、版面指到不存在的欄位):登記之前就停,沒有身分也沒有安裝紀錄", async () => {
      const missingModule = await runSeeds(app, [
        formSeed("seed_invalid_a", "r1", { moduleKey: "no-such-module" }),
      ]);
      const broken = formSeed("seed_invalid_b", "r1");
      broken.definition.layout.sections[0]?.rows.push({
        cols: [{ fieldKey: "ghost", span: 12 }],
      });
      const invalidLayout = await runSeeds(app, [broken]);

      expect(missingModule.results[0]?.conflict?.code).toBe(
        "DEFINITION_INVALID",
      );
      expect(invalidLayout.results[0]?.conflict?.code).toBe(
        "DEFINITION_INVALID",
      );
      for (const key of ["seed_invalid_a", "seed_invalid_b"]) {
        expect(await definitionDoc(connection, FORM, key)).toBeNull();
        expect(await installationsOf(connection, key)).toEqual([]);
      }
    });
  });
});
