import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Connection } from "mongoose";

import { AuditService } from "../../audit/audit.service";
import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  FORM_TEST_TIMEOUT_MS,
  FORM_VERSION,
  FORM_VERSIONS,
  MODULE_FORMS,
  MODULE_KEY,
  PUBLISH,
  RETIRE_CURRENT,
  SAVE_DRAFT,
  type VersionRow,
  call,
  codeOf,
  definitionOf,
  extensionsOf,
  field,
  getForm,
  nextRequestId,
  ok,
  publishDefinition,
  publishNewForm,
  rootToken,
  saveDefinition,
  showKey,
} from "../test-support/form-fixtures";
import { FormPublishHooks, type PublishCheckpoint } from "./form-publish-hooks";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface PermissionDoc {
  _id: unknown;
  key: string;
  name: string;
  source: string;
  retiredAt: Date | null;
}

/**
 * 四步發布(一個交易)與重試(Spec 6a §6、§10「發布」):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 「中途失敗」以 `FormPublishHooks` 在指定檢查點丟錯模擬(TEST-07 的第二個接縫;理由見該檔註解)。
 */
describe("表單發布(四步一個交易)與退役", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let token: string;
  let hooks: FormPublishHooks;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-publish");
    connection = api.connection;
    token = await rootToken(api);
    hooks = api.app.get(FormPublishHooks);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** 第 `nth` 次走到 `checkpoint` 時丟錯(其餘照常)。 */
  function failAt(checkpoint: PublishCheckpoint, nth = 1): void {
    let seen = 0;
    jest.spyOn(hooks, "reached").mockImplementation((reached) => {
      if (reached === checkpoint) {
        seen += 1;
        if (seen === nth) {
          return Promise.reject(new Error(`injected failure at ${checkpoint}`));
        }
      }
      return Promise.resolve();
    });
  }

  function permissionsOf(formKey: string): Promise<PermissionDoc[]> {
    return connection
      .collection("permissions")
      .find<PermissionDoc>({
        key: {
          $regex: String.raw`^${MODULE_KEY}\.(show|edit)-${formKey}-`,
        },
      })
      .sort({ key: 1 })
      .toArray();
  }

  /** 這張表單的「退役目前版本」稽核筆數。 */
  function retireAuditsOf(formKey: string): Promise<number> {
    return connection.collection("audit_logs").countDocuments({
      action: "form-version.retire",
      "before.formKey": formKey,
    });
  }

  async function versionsOf(formKey: string): Promise<VersionRow[]> {
    const data = await ok<{
      formVersions: { items: VersionRow[] };
    }>(api, token, FORM_VERSIONS, { formKey });
    return data.formVersions.items;
  }

  /** 發布後的整體狀態(版本狀態、currentVersion、權限),去掉 formKey 以便兩張表單互比。 */
  async function stateOf(formKey: string): Promise<unknown> {
    const form = await getForm(api, token, formKey);
    const versions = await versionsOf(formKey);
    const permissions = await permissionsOf(formKey);
    return {
      currentVersion: form.currentVersion,
      versions: versions.map((version) => ({
        version: version.version,
        status: version.status,
      })),
      permissions: permissions.map((permission) => ({
        key: permission.key.replace(formKey, "<form>"),
        name: permission.name.replace(formKey, "<form>"),
        source: permission.source,
        retired: permission.retiredAt !== null,
      })),
    };
  }

  /** 發布前、失敗後都要一致的部分(含草稿與它的 draftRevision、這張表單的發布稽核)。 */
  async function snapshotOf(formKey: string): Promise<unknown> {
    const drafts = await connection
      .collection("form_versions")
      .find({ formKey, status: "draft" })
      .project({ _id: 1, draftRevision: 1, version: 1 })
      .toArray();
    const audits = await connection.collection("audit_logs").countDocuments({
      action: "form-version.publish",
      "after.formKey": formKey,
    });
    return { state: await stateOf(formKey), drafts, audits };
  }

  const v1Fields = [
    field("title", "text"),
    field("amount", "number", { permission: { show: true, edit: false } }),
    field("note", "text", { permission: { show: false, edit: true } }),
  ];
  const v2Fields = [
    field("title", "text"),
    field("amount", "number", {
      label: "內部金額",
      permission: { show: true, edit: true },
    }),
    field("memo", "text", { permission: { show: true, edit: false } }),
  ];

  it("四步完整走完:版號在搶鎖時配、權限建好且名稱 = 「表單名 / 欄位 label 可見 / 可改」、currentVersion 指向新版", async () => {
    await ok(api, token, CREATE_FORM, {
      input: { key: "pub_full", moduleKey: MODULE_KEY, name: "完整發布" },
    });
    const draft = await ok<{
      createFormVersionDraft: { formVersion: VersionRow };
    }>(api, token, CREATE_DRAFT, { input: { formKey: "pub_full" } });
    expect(draft.createFormVersionDraft.formVersion).toMatchObject({
      version: null,
      status: "DRAFT",
      draftRevision: 0,
    });
    const saved = await saveDefinition(
      api,
      token,
      "pub_full",
      definitionOf(v1Fields),
      0,
    );
    expect(saved.draftRevision).toBe(1);
    const published = await ok<{
      publishFormVersion: { formVersion: VersionRow };
    }>(api, token, PUBLISH, {
      input: {
        formKey: "pub_full",
        expectedDraftRevision: 1,
        changelog: "第一版",
      },
    });
    expect(published.publishFormVersion.formVersion).toMatchObject({
      version: 1,
      status: "PUBLISHED",
      changelog: "第一版",
    });
    const form = await getForm(api, token, "pub_full");
    expect(form).toMatchObject({
      currentVersion: 1,
      hasDraft: false,
    });
    const permissions = await permissionsOf("pub_full");
    expect(
      permissions.map(({ key, name, source, retiredAt }) => ({
        key,
        name,
        source,
        retiredAt,
      })),
    ).toEqual([
      {
        key: `${MODULE_KEY}.edit-pub_full-note`,
        name: "完整發布 / note 可改",
        source: "dynamic",
        retiredAt: null,
      },
      {
        key: showKey("pub_full", "amount"),
        name: "完整發布 / amount 可見",
        source: "dynamic",
        retiredAt: null,
      },
    ]);
    const audit = await connection
      .collection("audit_logs")
      .findOne({ action: "form-version.publish" });
    expect(audit?.after).toMatchObject({ formKey: "pub_full", version: 1 });
  });

  it("發布下一版:前一版自動退役、權限依新版建 / 退役、`name` 隨 label 更新;以任一版本為基底開草稿", async () => {
    await publishNewForm(
      api,
      token,
      "pub_next",
      definitionOf(v1Fields),
      "下一版",
    );
    const v2 = await publishDefinition(
      api,
      token,
      "pub_next",
      definitionOf(v2Fields),
      1,
    );
    expect(v2.version).toBe(2);
    const versions = await versionsOf("pub_next");
    expect(
      versions.map((version) => [version.version, version.status]),
    ).toEqual([
      [2, "PUBLISHED"],
      [1, "RETIRED"],
    ]);
    const permissions = await permissionsOf("pub_next");
    const byKey = new Map(permissions.map((doc) => [doc.key, doc]));
    expect(byKey.get(showKey("pub_next", "amount"))).toMatchObject({
      name: "下一版 / 內部金額 可見",
      retiredAt: null,
    });
    expect(
      byKey.get(`${MODULE_KEY}.edit-pub_next-amount`)?.retiredAt,
    ).toBeNull();
    expect(byKey.get(showKey("pub_next", "memo"))?.retiredAt).toBeNull();
    // v2 不再宣告 note 的 edit → 退役(不刪)
    expect(
      byKey.get(`${MODULE_KEY}.edit-pub_next-note`)?.retiredAt,
    ).toBeInstanceOf(Date);

    // 以已退役的 v1 為基底開草稿:複製 v1 的欄位,記 baseVersion
    const draft = await ok<{
      createFormVersionDraft: { formVersion: VersionRow };
    }>(api, token, CREATE_DRAFT, {
      input: { formKey: "pub_next", baseVersion: 1 },
    });
    expect(draft.createFormVersionDraft.formVersion.baseVersion).toBe(1);
    expect(
      draft.createFormVersionDraft.formVersion.fields.map((item) => item.key),
    ).toEqual(["title", "amount", "note"]);
    // 已有草稿 → 409
    const again = await call(api, token, CREATE_DRAFT, {
      input: { formKey: "pub_next", baseVersion: 2 },
    });
    expect(codeOf(again)).toBe("CONFLICT");
    expect(extensionsOf(again).reason).toBe("DRAFT_EXISTS");

    // 恢復舊欄位 → 權限復活(同一筆,不是新建)
    const noteBefore = byKey.get(`${MODULE_KEY}.edit-pub_next-note`);
    const saved = await ok<{
      saveFormVersionDraft: { formVersion: VersionRow };
    }>(api, token, SAVE_DRAFT, {
      input: {
        formKey: "pub_next",
        expectedDraftRevision: 0,
        ...definitionOf(v1Fields),
      },
    });
    await ok(api, token, PUBLISH, {
      input: {
        formKey: "pub_next",
        expectedDraftRevision:
          saved.saveFormVersionDraft.formVersion.draftRevision,
        changelog: "恢復 note",
      },
    });
    const afterRevive = await permissionsOf("pub_next");
    const revived = afterRevive.find(
      (doc) => doc.key === `${MODULE_KEY}.edit-pub_next-note`,
    );
    expect(revived?.retiredAt).toBeNull();
    expect(String(revived?._id)).toBe(String(noteBefore?._id));
  });

  it("`expectedDraftRevision` 不符:存草稿與發布都 409,資料不動", async () => {
    await ok(api, token, CREATE_FORM, {
      input: { key: "pub_stale", moduleKey: MODULE_KEY, name: "過期" },
    });
    await ok(api, token, CREATE_DRAFT, { input: { formKey: "pub_stale" } });
    await saveDefinition(api, token, "pub_stale", definitionOf(v1Fields), 0);
    const staleSave = await call(api, token, SAVE_DRAFT, {
      input: {
        formKey: "pub_stale",
        expectedDraftRevision: 0,
        ...definitionOf(v2Fields),
      },
    });
    expect(codeOf(staleSave)).toBe("CONFLICT");
    expect(extensionsOf(staleSave).reason).toBe("DRAFT_REVISION_MISMATCH");
    const stalePublish = await call(api, token, PUBLISH, {
      input: {
        formKey: "pub_stale",
        expectedDraftRevision: 0,
        changelog: "x",
      },
    });
    expect(codeOf(stalePublish)).toBe("CONFLICT");
    const draft = await ok<{ formVersion: { formVersion: VersionRow } }>(
      api,
      token,
      FORM_VERSION,
      { formKey: "pub_stale" },
    );
    expect(draft.formVersion.formVersion).toMatchObject({
      status: "DRAFT",
      draftRevision: 1,
      version: null,
    });
  });

  it("兩個發布同時送出:只有一個成功,另一個 409;版號只配一次", async () => {
    await ok(api, token, CREATE_FORM, {
      input: { key: "pub_race", moduleKey: MODULE_KEY, name: "競速" },
    });
    await ok(api, token, CREATE_DRAFT, { input: { formKey: "pub_race" } });
    await saveDefinition(api, token, "pub_race", definitionOf(v1Fields), 0);
    const input = {
      input: { formKey: "pub_race", expectedDraftRevision: 1, changelog: "搶" },
    };
    const results = await Promise.all([
      call(api, token, PUBLISH, input),
      call(api, token, PUBLISH, input),
    ]);
    const codes = results
      .map((result) => codeOf(result) ?? "OK")
      .toSorted((a, b) => a.localeCompare(b));
    expect(codes).toEqual(["CONFLICT", "OK"]);
    const versions = await versionsOf("pub_race");
    expect(versions.map((version) => version.version)).toEqual([1]);
  });

  it("檢查器有錯就不能發布(什麼都沒改);錯誤帶定位", async () => {
    await ok(api, token, CREATE_FORM, {
      input: { key: "pub_invalid", moduleKey: MODULE_KEY, name: "有錯" },
    });
    await ok(api, token, CREATE_DRAFT, { input: { formKey: "pub_invalid" } });
    const invalid = definitionOf([
      field("title", "text"),
      field("title", "text"),
    ]);
    await saveDefinition(api, token, "pub_invalid", invalid, 0);
    const result = await call(api, token, PUBLISH, {
      input: {
        formKey: "pub_invalid",
        expectedDraftRevision: 1,
        changelog: "x",
      },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    const issues = extensionsOf(result).issues as { code: string }[];
    expect(issues.map((issue) => issue.code)).toContain("KEY_DUPLICATE");
    const form = await getForm(api, token, "pub_invalid");
    expect(form).toMatchObject({ currentVersion: null, hasDraft: true });
  });

  describe("發布任一步失敗 → 版本、欄位級權限、表單狀態都回到發布前(一個交易)", () => {
    let baseline: unknown;

    beforeAll(async () => {
      await publishNewForm(api, token, "pub_base", definitionOf(v1Fields));
      await publishDefinition(
        api,
        token,
        "pub_base",
        definitionOf(v2Fields),
        1,
      );
      baseline = await stateOf("pub_base");
    }, HOOK_TIMEOUT_MS);

    const cases: [string, PublishCheckpoint | "audit", number][] = [
      ["步驟 2:搶鎖配版號之後(寫稽核時)失敗", "audit", 1],
      ["步驟 3:建第二筆權限時失敗", "permission", 2],
      ["步驟 3:退役權限時失敗", "retire-permission", 1],
      ["步驟 4:這一版改 published 時失敗", "publish-version", 1],
      ["步驟 4:切換前一版為退役時失敗", "retire-previous", 1],
      ["步驟 4:最後一筆(currentVersion)失敗", "current-version", 1],
    ];

    it.each(cases)("%s", async (_label, checkpoint, nth) => {
      const formKey = `pub_${checkpoint.replaceAll("-", "_")}_${String(nth)}`;
      await publishNewForm(api, token, formKey, definitionOf(v1Fields));
      await ok(api, token, CREATE_DRAFT, {
        input: { formKey, baseVersion: 1 },
      });
      await saveDefinition(api, token, formKey, definitionOf(v2Fields), 0);
      const before = await snapshotOf(formKey);
      if (checkpoint === "audit") {
        jest
          .spyOn(api.app.get(AuditService), "record")
          .mockRejectedValueOnce(new Error("injected failure at audit"));
      } else {
        failAt(checkpoint, nth);
      }
      const failed = await call(api, token, PUBLISH, {
        input: { formKey, expectedDraftRevision: 1, changelog: "測試發布" },
      });
      expect(failed.errors).toBeDefined();
      jest.restoreAllMocks();
      // 回到發布前:草稿還在(同一份、同 revision)、v1 仍是目前版本、權限沒動、沒有稽核
      expect(await snapshotOf(formKey)).toEqual(before);
      expect(await getForm(api, token, formKey)).toMatchObject({
        currentVersion: 1,
        hasDraft: true,
      });

      // 再發布一次就與一次成功相同
      await ok(api, token, PUBLISH, {
        input: { formKey, expectedDraftRevision: 1, changelog: "測試發布" },
      });
      expect(await stateOf(formKey)).toEqual(
        JSON.parse(JSON.stringify(baseline).replaceAll("pub_base", formKey)),
      );
    });
  });

  it("依表單分開新增權限(B9b):發布失敗 → 這次新建的 `create-<formKey>` 跟著回復;再發布才建", async () => {
    const formKey = "pub_per_form_create";
    const createKey = `${MODULE_KEY}.create-${formKey}`;
    const countCreateKey = () =>
      connection.collection("permissions").countDocuments({ key: createKey });
    await ok(api, token, CREATE_FORM, {
      input: { key: formKey, moduleKey: MODULE_KEY, name: "依表單新增" },
    });
    await ok(api, token, CREATE_DRAFT, {
      input: { formKey, baseVersion: null },
    });
    await saveDefinition(api, token, formKey, definitionOf(v1Fields), 0);
    // seed 宣告的開關;測試直接改資料庫模擬開啟,結束時還原(不影響本檔其他案例)
    await connection
      .collection("modules")
      .updateOne({ key: MODULE_KEY }, { $set: { perFormCreate: true } });
    try {
      // 步驟 3 建好權限之後、步驟 4 最後一筆失敗
      failAt("current-version");
      const failed = await call(api, token, PUBLISH, {
        input: { formKey, expectedDraftRevision: 1, changelog: "測試發布" },
      });
      expect(failed.errors).toBeDefined();
      jest.restoreAllMocks();
      expect(await countCreateKey()).toBe(0);

      await ok(api, token, PUBLISH, {
        input: { formKey, expectedDraftRevision: 1, changelog: "測試發布" },
      });
      expect(await countCreateKey()).toBe(1);
    } finally {
      await connection
        .collection("modules")
        .updateOne({ key: MODULE_KEY }, { $set: { perFormCreate: false } });
    }
  });

  it("currentVersion 用條件更新:讀到之後被別人改了 → 409,整個發布回復,不蓋掉", async () => {
    await publishNewForm(api, token, "pub_cas", definitionOf(v1Fields));
    await ok(api, token, CREATE_DRAFT, {
      input: { formKey: "pub_cas", baseVersion: 1 },
    });
    await saveDefinition(api, token, "pub_cas", definitionOf(v2Fields), 0);
    // 走到步驟 4c 之前,有人在交易外把 currentVersion 改掉了(模擬同時進行的退役)
    jest.spyOn(hooks, "reached").mockImplementation(async (checkpoint) => {
      if (checkpoint === "current-version") {
        await connection
          .collection("forms")
          .updateOne({ key: "pub_cas" }, { $set: { currentVersion: null } });
      }
    });
    const result = await call(api, token, PUBLISH, {
      input: { formKey: "pub_cas", expectedDraftRevision: 1, changelog: "x" },
    });
    // 條件更新以發布開始時讀到的 currentVersion 為準(寫入衝突自動重跑也一樣):不命中 → 409、不蓋掉
    expect(codeOf(result)).toBe("CONFLICT");
    expect(extensionsOf(result).reason).toBe("CURRENT_VERSION_CHANGED");
    const raw = await connection
      .collection("forms")
      .findOne<{ currentVersion: number | null }>({ key: "pub_cas" });
    expect(raw?.currentVersion).toBeNull();
    const versions = await versionsOf("pub_cas");
    expect(
      versions
        .map((version) => version.status)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["DRAFT", "PUBLISHED"]);
  });

  it("退役目前版本:版本改 retired、currentVersion → null,之後不可新增;再發布才恢復", async () => {
    await publishNewForm(
      api,
      token,
      "pub_retire",
      definitionOf([field("title", "text")]),
    );
    const retired = await ok<{ retireCurrentVersion: { form: unknown } }>(
      api,
      token,
      RETIRE_CURRENT,
      { input: { formKey: "pub_retire", expectedVersion: 1 } },
    );
    expect(retired.retireCurrentVersion.form).toMatchObject({
      currentVersion: null,
    });
    const versions = await versionsOf("pub_retire");
    expect(versions[0]?.status).toBe("RETIRED");
    const forms = await ok<{ moduleForms: { key: string }[] }>(
      api,
      token,
      MODULE_FORMS,
      { moduleKey: MODULE_KEY },
    );
    expect(forms.moduleForms.map((item) => item.key)).not.toContain(
      "pub_retire",
    );
    const create = await call(api, token, CREATE_FORM_DRAFT, {
      input: { formKey: "pub_retire", clientRequestId: nextRequestId() },
    });
    expect(codeOf(create)).toBe("FORBIDDEN");
    expect(extensionsOf(create).reason).toBe("FORM_NOT_AVAILABLE");
    // 同一版再退役一次 = 已是目標狀態,視為完成(冪等,不 409),什麼都沒改所以不寫稽核
    expect(await retireAuditsOf("pub_retire")).toBe(1);
    const again = await ok<{ retireCurrentVersion: { form: unknown } }>(
      api,
      token,
      RETIRE_CURRENT,
      { input: { formKey: "pub_retire", expectedVersion: 1 } },
    );
    expect(again.retireCurrentVersion.form).toMatchObject({
      currentVersion: null,
    });
    expect(await retireAuditsOf("pub_retire")).toBe(1);
    // 從來沒發布過的版號 → 409
    const missing = await call(api, token, RETIRE_CURRENT, {
      input: { formKey: "pub_retire", expectedVersion: 9 },
    });
    expect(extensionsOf(missing).reason).toBe("NO_CURRENT_VERSION");

    await publishDefinition(
      api,
      token,
      "pub_retire",
      definitionOf([field("title", "text")]),
      1,
    );
    const after = await ok<{ moduleForms: { key: string }[] }>(
      api,
      token,
      MODULE_FORMS,
      { moduleKey: MODULE_KEY },
    );
    expect(after.moduleForms.map((item) => item.key)).toContain("pub_retire");
  });

  it("退役帶舊的 expectedVersion:發布切換到新版之後 → 409,新版不受影響", async () => {
    await publishNewForm(
      api,
      token,
      "pub_retire_stale",
      definitionOf(v1Fields),
    );
    await publishDefinition(
      api,
      token,
      "pub_retire_stale",
      definitionOf(v2Fields),
      1,
    );
    const stale = await call(api, token, RETIRE_CURRENT, {
      input: { formKey: "pub_retire_stale", expectedVersion: 1 },
    });
    expect(codeOf(stale)).toBe("CONFLICT");
    expect(extensionsOf(stale).reason).toBe("CURRENT_VERSION_CHANGED");
    expect(await getForm(api, token, "pub_retire_stale")).toMatchObject({
      currentVersion: 2,
    });
    const versions = await versionsOf("pub_retire_stale");
    expect(versions.find((item) => item.version === 2)?.status).toBe(
      "PUBLISHED",
    );
  });

  it("退役第二步失敗 → 版本與 currentVersion 都回到退役前(一個交易),沒有稽核;再退役一次就完成", async () => {
    await publishNewForm(
      api,
      token,
      "pub_retire_tx",
      definitionOf([field("title", "text")]),
    );
    failAt("retire-current");
    const failed = await call(api, token, RETIRE_CURRENT, {
      input: { formKey: "pub_retire_tx", expectedVersion: 1 },
    });
    expect(failed.errors).toBeDefined();
    jest.restoreAllMocks();
    const [version] = await versionsOf("pub_retire_tx");
    expect(version?.status).toBe("PUBLISHED");
    expect(await getForm(api, token, "pub_retire_tx")).toMatchObject({
      currentVersion: 1,
    });
    expect(await retireAuditsOf("pub_retire_tx")).toBe(0);

    const retired = await ok<{ retireCurrentVersion: { form: unknown } }>(
      api,
      token,
      RETIRE_CURRENT,
      { input: { formKey: "pub_retire_tx", expectedVersion: 1 } },
    );
    expect(retired.retireCurrentVersion.form).toMatchObject({
      currentVersion: null,
    });
    expect(await retireAuditsOf("pub_retire_tx")).toBe(1);
  });
});
