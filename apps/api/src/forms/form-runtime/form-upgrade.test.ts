import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { FormSubmissionsRepository } from "../../database/database.module";
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { writeCountConflictError } from "../../database/write-conflict";
import { SubmissionValuesService } from "../form-values/submission-values.service";
import {
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  UPDATE_SUBMISSION,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  nextRequestId,
  ok,
  publishDefinition,
  publishNewForm,
  rawSubmission,
  rootToken,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const PLAN = /* GraphQL */ `
  query Plan($formKey: ID!, $targetVersion: Int!) {
    formUpgradePlan(formKey: $formKey, targetVersion: $targetVersion) {
      groups {
        fromVersion
        count
      }
      fillTargets
    }
  }
`;

const UPGRADE = /* GraphQL */ `
  mutation Upgrade($input: UpgradeFormSubmissionsInput!) {
    upgradeFormSubmissions(input: $input) {
      upgraded {
        fromVersion
        count
      }
      skipped {
        reason
        count
      }
    }
  }
`;

const REVISIONS = /* GraphQL */ `
  query Revisions($id: ID!, $revision: Int) {
    formSubmission(id: $id, revision: $revision) {
      submission {
        version
        viewedVersion
        values
        revisions {
          revision
          version
          kind
        }
      }
    }
  }
`;

const DETAIL = /* GraphQL */ `
  query Detail($id: ID!) {
    formSubmission(id: $id) {
      submission {
        id
        values
      }
    }
  }
`;

interface UpgradeResult {
  upgraded: { fromVersion: number; count: number }[];
  skipped: { reason: string; count: number }[];
}

interface RawRevision {
  revision: number;
  version?: number;
  kind?: string;
  values: Record<string, unknown>;
  ctx: { userId: Types.ObjectId | null; at: Date };
  upgradedBy?: Types.ObjectId | null;
  upgradedAt?: Date;
}

interface RawSubmission {
  _id: Types.ObjectId;
  version: number;
  status: string;
  revision: number;
  editVersion: number;
  values: Record<string, unknown>;
  summary: { title: string | null } | null;
  revisions: RawRevision[];
}

/** 第 1 版:標題、數量、之後會拿掉的備註。 */
const V1: FormDefinition = definitionOf([
  field("title", "text"),
  field("amount", "number"),
  field("dropped", "text"),
]);

/** 第 2 版:標題改必填、拿掉備註、新增必填欄位與計算欄位。 */
const V2: FormDefinition = definitionOf([
  field("title", "text", { rules: { required: true } }),
  field("amount", "number"),
  field("added", "text", { rules: { required: true } }),
  field("double", "number", {
    valueSource: {
      kind: "computed",
      expr: { "*": [{ var: "amount" }, 2] },
    },
  }),
]);

/**
 * 舊版資料升級到新版(只限沒綁流程的表單):改綁 + 補值 + 重算,不驗證;每筆修訂記版本。
 * 每個案例用自己的表單(第 1 版建一筆已完成、一筆草稿,再發布第 2 版)。
 */
describe("舊版資料升級到新版", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;
  let staff: FormOperator;
  let formSequence = 0;

  /**
   * 一張表單:第 1 版的已完成(標題、數量、備註)與草稿(只有數量),再發布第 2 版。
   * `extraPairs` = 另外多建幾組已完成 + 草稿(整批讀寫的指令數測試用)。
   */
  async function prepare(extraPairs = 0): Promise<{
    formKey: string;
    completedId: string;
    draftId: string;
  }> {
    formSequence += 1;
    const formKey = `upgrade_${String(formSequence)}`;
    await publishNewForm(api, root, formKey, V1);
    await assignForm(api, root, formKey, [tenant]);
    const completed = await createSubmitted(api, staff.token, formKey, {
      title: "出差",
      amount: 3,
      dropped: "舊備註",
    });
    const draft = await createDraft(api, staff.token, formKey, { amount: 5 });
    for (let index = 0; index < extraPairs; index += 1) {
      await createSubmitted(api, staff.token, formKey, {
        title: `第 ${String(index)} 張`,
        amount: index,
      });
      await createDraft(api, staff.token, formKey, { amount: index });
    }
    await publishDefinition(api, root, formKey, V2, 1);
    return { formKey, completedId: completed.id, draftId: draft.id };
  }

  function upgrade(
    token: string,
    formKey: string,
    fills: Record<string, unknown> = {},
    clientRequestId = nextRequestId(),
  ) {
    return call<{ upgradeFormSubmissions: UpgradeResult }>(
      api,
      token,
      UPGRADE,
      { input: { formKey, targetVersion: 2, fills, clientRequestId } },
    );
  }

  async function raw(id: string): Promise<RawSubmission> {
    return (await rawSubmission(connection, id)) as unknown as RawSubmission;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-upgrade");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "升級租戶" });
    staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("升級計畫:各舊版本的筆數與補值欄位(必填、摘要槽、新增)", async () => {
    const { formKey } = await prepare();

    const data = await ok<{
      formUpgradePlan: {
        groups: { fromVersion: number; count: number }[];
        fillTargets: { key: string }[];
      };
    }>(api, staff.token, PLAN, { formKey, targetVersion: 2 });

    expect(data.formUpgradePlan.groups).toEqual([{ fromVersion: 1, count: 2 }]);
    expect(
      data.formUpgradePlan.fillTargets.map((target) => target.key),
    ).toEqual(["title", "added"]);
  });

  it("已完成:改綁、修訂 +1 記目標版與升級標記、丟掉目標版沒有的欄位、計算欄位與摘要重算", async () => {
    const { formKey, completedId } = await prepare();

    const result = await upgrade(staff.token, formKey, { added: "補值" });

    expect(result.errors).toBeUndefined();
    const after = await raw(completedId);
    expect(after).toMatchObject({
      version: 2,
      status: "completed",
      revision: 2,
    });
    expect(after.values).toEqual({
      title: "出差",
      amount: "3",
      added: "補值",
      double: "6",
    });
    expect(after.summary?.title).toBe("出差");
    expect(after.revisions.map((entry) => entry.version)).toEqual([1, 2]);
    expect(after.revisions[1]?.kind).toBe("upgrade");
    // 升級的修訂沿用上一筆的 ctx,誰升級另記
    expect(after.revisions[1]?.ctx).toEqual(after.revisions[0]?.ctx);
    expect(after.revisions[1]?.upgradedBy?.equals(staff.userId)).toBe(true);
    expect(after.revisions[1]?.upgradedAt).toBeInstanceOf(Date);
    expect(after.revisions[0]?.values.dropped).toBe("舊備註");
  });

  it("草稿:改綁、補值、重算,不加修訂", async () => {
    const { formKey, draftId } = await prepare();

    await upgrade(staff.token, formKey, { title: "補標題", added: "補值" });

    const after = await raw(draftId);
    expect(after).toMatchObject({ version: 2, status: "draft", revision: 0 });
    expect(after.revisions).toEqual([]);
    expect(after.values).toEqual({
      title: "補標題",
      amount: "5",
      added: "補值",
      double: "10",
    });
  });

  it("補值只填該筆沒有值的欄位,已有值不覆蓋", async () => {
    const { formKey, completedId } = await prepare();

    await upgrade(staff.token, formKey, { title: "補標題" });

    const stored = await raw(completedId);
    expect(stored.values.title).toBe("出差");
  });

  it("不驗證:升級後缺必填欄位照樣改綁", async () => {
    const { formKey, completedId } = await prepare();

    const result = await upgrade(staff.token, formKey);

    expect(result.data?.upgradeFormSubmissions.upgraded).toEqual([
      { fromVersion: 1, count: 2 },
    ]);
    const stored = await raw(completedId);
    expect(stored.values.added).toBeNull();
  });

  it("回各舊版本已升級的筆數", async () => {
    const { formKey } = await prepare();

    const result = await upgrade(staff.token, formKey, { added: "補值" });

    expect(result.data?.upgradeFormSubmissions).toEqual({
      upgraded: [{ fromVersion: 1, count: 2 }],
      skipped: [],
    });
  });

  it("本租戶綁了流程 → 409 FORM_HAS_WORKFLOW,什麼都不改", async () => {
    const { formKey, completedId } = await prepare();
    const form = await connection
      .collection("forms")
      .findOne<{ _id: Types.ObjectId }>({ key: formKey });
    await connection.collection("business_relationships").insertOne({
      tenantId: tenant,
      type: "org_form_workflow",
      firstId: tenant,
      secondId: form?._id,
      thirdId: new Types.ObjectId(),
      meta: {},
      deletedAt: null,
    });

    const result = await upgrade(staff.token, formKey);

    expect(codeOf(result)).toBe("CONFLICT");
    expect(extensionsOf(result).reason).toBe("FORM_HAS_WORKFLOW");
    const stored = await raw(completedId);
    expect(stored.version).toBe(1);
  });

  it("沒有模組 edit → 403", async () => {
    const { formKey } = await prepare();
    const viewer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create],
    });

    const result = await upgrade(viewer.token, formKey);

    expect(codeOf(result)).toBe("FORBIDDEN");
  });

  it("升級途中被別人改了:那一批的交易寫入衝突、自動整批重跑,重讀後照樣升級,不蓋掉別人的寫入", async () => {
    const { formKey, completedId } = await prepare();
    const before = await raw(completedId);
    const values = api.app.get(SubmissionValuesService);
    const evaluate = values.evaluate.bind(values);
    let interfered = false;
    const spy = jest
      .spyOn(values, "evaluate")
      .mockImplementation(async (input) => {
        // 算值與條件更新之間,別人(交易外)存了已完成那一筆;只發生一次
        if (!interfered) {
          interfered = true;
          await connection
            .collection("form_submissions")
            .updateOne(
              { _id: new Types.ObjectId(completedId) },
              { $inc: { editVersion: 1 } },
            );
        }
        return evaluate(input);
      });

    try {
      const result = await upgrade(staff.token, formKey);

      expect(result.errors).toBeUndefined();
      expect(result.data?.upgradeFormSubmissions.skipped).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const stored = await raw(completedId);
    expect(stored.version).toBe(2);
    // 別人的 +1 與升級的 +1 都在
    expect(stored.editVersion).toBe(before.editVersion + 2);
  });

  it("冪等:再升級一次沒有要升級的", async () => {
    const { formKey } = await prepare();
    await upgrade(staff.token, formKey);

    const again = await upgrade(staff.token, formKey);

    expect(again.data?.upgradeFormSubmissions).toEqual({
      upgraded: [],
      skipped: [],
    });
  });

  it("同一個 clientRequestId 重送回第一次的結果", async () => {
    const { formKey } = await prepare();
    const clientRequestId = nextRequestId();
    const first = await upgrade(staff.token, formKey, {}, clientRequestId);

    const retried = await upgrade(staff.token, formKey, {}, clientRequestId);

    expect(retried.data).toEqual(first.data);
  });

  it("升級後讀修訂:每筆修訂帶自己的版本,舊修訂用舊版渲染", async () => {
    const { formKey, completedId } = await prepare();
    await upgrade(staff.token, formKey);

    const first = await ok<{
      formSubmission: {
        submission: {
          version: number;
          viewedVersion: number;
          values: Record<string, unknown>;
          revisions: {
            revision: number;
            version: number;
            kind: string | null;
          }[];
        };
      };
    }>(api, staff.token, REVISIONS, { id: completedId, revision: 1 });

    const submission = first.formSubmission.submission;
    expect(submission.version).toBe(2);
    expect(submission.viewedVersion).toBe(1);
    expect(submission.values.dropped).toBe("舊備註");
    expect(submission.revisions).toEqual([
      { revision: 1, version: 1, kind: null },
      { revision: 2, version: 2, kind: "upgrade" },
    ]);
  });

  describe("整批讀寫(TX-06)", () => {
    it("一批 2 筆與 20 筆的資料庫指令數相同(整批讀、整批寫回)", async () => {
      const small = await prepare();
      const large = await prepare(9);

      const few = await countDbCommands(() =>
        upgrade(staff.token, small.formKey),
      );
      const many = await countDbCommands(() =>
        upgrade(staff.token, large.formKey),
      );

      expect(few.result.data?.upgradeFormSubmissions.upgraded).toEqual([
        { fromVersion: 1, count: 2 },
      ]);
      expect(many.result.data?.upgradeFormSubmissions.upgraded).toEqual([
        { fromVersion: 1, count: 20 },
      ]);
      expectDbCommandsAtMost(many, few.total, "升級 20 筆");
      expect(many.byCommand.get("form_submissions.bulkWrite")).toBe(1);
      // 分組計數一次 + 取這批 id 與大小一次(不再另用 find 取 id)
      expect(many.byCommand.get("form_submissions.aggregate")).toBe(2);
      expect(
        many.byCommand.get("form_submissions.findOneAndUpdate"),
      ).toBeUndefined();
    });

    it("升級計畫:多個舊版本的筆數一次分組計數,不逐版本 count", async () => {
      const { formKey } = await prepare();
      await createDraft(api, staff.token, formKey, { amount: 7 });
      await publishDefinition(api, root, formKey, V2, 2);

      const counted = await countDbCommands(() =>
        ok<{
          formUpgradePlan: { groups: { fromVersion: number; count: number }[] };
        }>(api, staff.token, PLAN, { formKey, targetVersion: 3 }),
      );

      expect(counted.result.formUpgradePlan.groups).toEqual([
        { fromVersion: 1, count: 2 },
        { fromVersion: 2, count: 1 },
      ]);
      expect(counted.byCommand.get("form_submissions.aggregate")).toBe(1);
      expect(
        counted.byCommand.get("form_submissions.countDocuments"),
      ).toBeUndefined();
    });

    it("同一批兩個來源版本:版本定義一次讀齊,兩版都升級", async () => {
      const { formKey, completedId } = await prepare();
      const second = await createDraft(api, staff.token, formKey, {
        amount: 7,
      });
      await publishDefinition(api, root, formKey, V2, 2);

      const counted = await countDbCommands(() =>
        call<{ upgradeFormSubmissions: UpgradeResult }>(
          api,
          staff.token,
          UPGRADE,
          {
            input: {
              formKey,
              targetVersion: 3,
              fills: {},
              clientRequestId: nextRequestId(),
            },
          },
        ),
      );

      expect(counted.result.data?.upgradeFormSubmissions).toEqual({
        upgraded: [
          { fromVersion: 1, count: 2 },
          { fromVersion: 2, count: 1 },
        ],
        skipped: [],
      });
      // 讀版本定義:舊版本清單、補值欄位、整批的來源版本各一次(兩個來源版本一起讀)
      expect(counted.byCommand.get("form_versions.find")).toBe(3);
      expect(counted.byCommand.get("form_submissions.bulkWrite")).toBe(1);
      const [fromFirst, fromSecond] = await Promise.all([
        raw(completedId),
        raw(second.id),
      ]);
      expect([fromFirst.version, fromSecond.version]).toEqual([3, 3]);
    });

    it("整批寫回筆數不符一次:重讀這批再跑一次就升級,不改逐筆", async () => {
      const { formKey, completedId, draftId } = await prepare();
      const repository = api.app.get(FormSubmissionsRepository);
      const bulk = jest
        .spyOn(repository, "bulkUpdateByIds")
        .mockRejectedValueOnce(writeCountConflictError("模擬筆數不符"));
      const single = jest.spyOn(repository, "findOneAndUpdate");

      try {
        const result = await upgrade(staff.token, formKey);

        expect(result.data?.upgradeFormSubmissions).toEqual({
          upgraded: [{ fromVersion: 1, count: 2 }],
          skipped: [],
        });
        expect(bulk).toHaveBeenCalledTimes(2);
        expect(single).not.toHaveBeenCalled();
      } finally {
        bulk.mockRestore();
        single.mockRestore();
      }
      const [completed, draft] = await Promise.all([
        raw(completedId),
        raw(draftId),
      ]);
      expect(completed.version).toBe(2);
      expect(draft.version).toBe(2);
    });

    it("整批一直不符:改逐筆,衝突的那一筆跳過(EDIT_CONFLICT)、其他照升", async () => {
      const { formKey, completedId, draftId } = await prepare();
      const repository = api.app.get(FormSubmissionsRepository);
      const bulk = jest
        .spyOn(repository, "bulkUpdateByIds")
        .mockRejectedValue(writeCountConflictError("模擬筆數不符"));
      // 逐筆時第一筆(已完成,id 較小)的條件更新沒命中 = 被人同時改了
      const single = jest
        .spyOn(repository, "findOneAndUpdate")
        .mockResolvedValueOnce(null);

      try {
        const result = await upgrade(staff.token, formKey);

        expect(result.data?.upgradeFormSubmissions).toEqual({
          upgraded: [{ fromVersion: 1, count: 1 }],
          skipped: [{ reason: "EDIT_CONFLICT", count: 1 }],
        });
        expect(bulk).toHaveBeenCalledTimes(2);
        expect(single).toHaveBeenCalledTimes(2);
      } finally {
        bulk.mockRestore();
        single.mockRestore();
      }
      const [completed, draft] = await Promise.all([
        raw(completedId),
        raw(draftId),
      ]);
      expect(completed.version).toBe(1);
      expect(draft.version).toBe(2);
    });
  });

  describe("列表與詳情不載入全部修訂", () => {
    let formKey: string;
    let completedId: string;

    beforeAll(async () => {
      ({ formKey, completedId } = await prepare());
      const stored = await raw(completedId);
      await ok(api, staff.token, UPDATE_SUBMISSION, {
        input: {
          id: completedId,
          expectedEditVersion: stored.editVersion,
          expectedRevision: stored.revision,
          values: { ...stored.values, title: "第二版" },
        },
      });
    }, HOOK_TIMEOUT_MS);

    it("列表:每筆最多只讀到最後一筆修訂", async () => {
      const repository = api.app.get(FormSubmissionsRepository);
      const spy = jest.spyOn(repository, "findMany");
      try {
        await ok(api, staff.token, FORM_SUBMISSIONS, {
          input: { moduleKey: MODULE_KEY, formKey },
        });
        const loaded = await Promise.all(
          spy.mock.results.map(
            (entry) => entry.value as Promise<RawSubmission[]>,
          ),
        );

        const mine = loaded
          .flat()
          .filter((record) => String(record._id) === completedId);
        expect(mine.map((record) => record.revisions.length)).toEqual([1]);
      } finally {
        spy.mockRestore();
      }
    });

    it("詳情:只讀到最後一筆修訂", async () => {
      const repository = api.app.get(FormSubmissionsRepository);
      const spy = jest.spyOn(repository, "findOne");
      try {
        await ok(api, staff.token, DETAIL, { id: completedId });
        const loaded = await Promise.all(
          spy.mock.results.map(
            (entry) => entry.value as Promise<RawSubmission | null>,
          ),
        );

        const lengths = loaded
          .filter((record) => String(record?._id) === completedId)
          .map((record) => record?.revisions.length);
        expect(new Set(lengths)).toEqual(new Set([1]));
      } finally {
        spy.mockRestore();
      }
    });
  });
});
