import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose, { type HydratedDocument, type Model, Types } from "mongoose";

import { RecordingMailService } from "../mail/recording-mail.service";
import { BaseRepository } from "./base.repository";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { DemoItemOne, DemoItemOneSchema } from "./schemas/demo-item-one.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";
import {
  TransactionService,
  afterCommit,
  assertOutsideTransaction,
  currentSession,
} from "./transaction";

function operatorOf(orgId: Types.ObjectId): OperatorContext {
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [orgId],
    memberOrgIds: [],
    roleIds: [],
  };
}

/** 讓 driver 當成「寫入衝突」自動重試的錯誤(與伺服器回 WriteConflict 帶的標籤相同)。 */
function transientError(): Error {
  const error = new mongoose.mongo.MongoError("模擬寫入衝突");
  error.addErrorLabel("TransientTransactionError");
  return error;
}

/**
 * 交易入口(ADR「引入 Mongo 交易」):對真的單一成員 replica set 驗回復、交易後動作、
 * 自動重試、加入外層交易、上限,以及帶 session 時租戶保底照舊。
 */
describe("TransactionService.withTransaction(對真 MongoDB replica set)", () => {
  let database: TestDatabase;
  let model: Model<DemoItemOne>;
  let items: BaseRepository<DemoItemOne, HydratedDocument<DemoItemOne>>;
  let transactions: TransactionService;

  const rootOrgId = new Types.ObjectId();
  const orgA = new Types.ObjectId();
  const orgB = new Types.ObjectId();
  const asA = operatorOf(orgA);
  const asB = operatorOf(orgB);

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-transaction");
    model = database.connection.model<DemoItemOne>(
      DemoItemOne.name,
      DemoItemOneSchema,
    );
    // 交易內不能隱式建 collection 以外的東西;先把 collection 與索引建好(正式環境由 api 啟動時建)
    await model.init();
    items = new BaseRepository(model);
    transactions = new TransactionService(database.connection);
    await database.connection.collection("orgs").insertMany(
      [orgA, orgB].map((id) => ({
        _id: id,
        name: `組織 ${String(id)}`,
        parentId: rootOrgId,
        ancestors: [rootOrgId],
      })),
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  async function namesInDatabase(): Promise<string[]> {
    const documents = await database.connection
      .collection<{ name: string }>("demo_items_one")
      .find({}, { projection: { name: 1 } })
      .toArray();
    return documents
      .map((document) => document.name)
      .toSorted((a, b) => a.localeCompare(b));
  }

  it("成功:交易內的所有寫入一起生效,回傳 fn 的結果", async () => {
    const result = await transactions.withTransaction(async (session) => {
      const first = await items.create(asA, { name: "成功-1" }, { session });
      await items.create(asA, { name: "成功-2" }, { session });
      await items.updateById(
        asA,
        first._id,
        { $set: { name: "成功-1-改" } },
        { session },
      );
      return "完成";
    });

    expect(result).toBe("完成");
    expect(await namesInDatabase()).toEqual(
      expect.arrayContaining(["成功-1-改", "成功-2"]),
    );
  });

  describe("任一步驟注入錯誤 → 該交易內所有寫入都不存在", () => {
    /** 一個動作的四個寫入步驟:建立、改名、批次更新、軟刪除。 */
    const steps = ["建立", "改名", "批次更新", "軟刪除"] as const;

    it.each(steps.map((step, index) => [step, index]))(
      "在「%s」之後拋錯",
      async (_step, failAfter) => {
        const prefix = `回復-${String(failAfter)}`;
        const before = await namesInDatabase();
        const existing = await items.create(asA, { name: `${prefix}-既有` });

        await expect(
          transactions.withTransaction(async (session) => {
            const created = await items.create(
              asA,
              { name: `${prefix}-新` },
              { session },
            );
            if (failAfter === 0) throw new Error("注入錯誤");
            await items.updateById(
              asA,
              created._id,
              { $set: { name: `${prefix}-新-改` } },
              { session },
            );
            if (failAfter === 1) throw new Error("注入錯誤");
            await items.updateMany(
              asA,
              { name: `${prefix}-既有` },
              { $set: { name: `${prefix}-既有-改` } },
              { session },
            );
            if (failAfter === 2) throw new Error("注入錯誤");
            await items.softDeleteById(asA, existing._id, { session });
            throw new Error("注入錯誤");
          }),
        ).rejects.toThrow("注入錯誤");

        // 只剩交易前就存在的那筆,而且沒被改名、沒被軟刪除
        expect(await namesInDatabase()).toEqual(
          [...before, `${prefix}-既有`].toSorted((a, b) => a.localeCompare(b)),
        );
        await expect(items.findById(asA, existing._id)).resolves.toMatchObject({
          name: `${prefix}-既有`,
          deletedAt: null,
        });
      },
    );

    it("寫入本身失敗(資料驗證不過)也讓前面的寫入一起回復", async () => {
      const before = await namesInDatabase();
      await expect(
        transactions.withTransaction(async (session) => {
          await items.create(asA, { name: "驗證失敗前" }, { session });
          // 寫到可見範圍外的組織 → 租戶保底拒絕
          await items.create(asA, { name: "越界", orgId: orgB }, { session });
        }),
      ).rejects.toThrow(TenantScopeError);
      expect(await namesInDatabase()).toEqual(before);
    });

    it("沒帶 session 的 BaseRepository 讀寫自動加入目前的交易,一樣會回復", async () => {
      const before = await namesInDatabase();
      await expect(
        transactions.withTransaction(async () => {
          await items.create(asA, { name: "隱式 session" });
          // 交易內讀得到自己剛寫、尚未提交的資料 = 同一個 session
          await expect(
            items.findOne(asA, { name: "隱式 session" }),
          ).resolves.not.toBeNull();
          throw new Error("注入錯誤");
        }),
      ).rejects.toThrow("注入錯誤");
      expect(await namesInDatabase()).toEqual(before);
    });

    it("巢狀呼叫加入外層交易:內層拋錯,外層先寫的也一起回復", async () => {
      const before = await namesInDatabase();
      await expect(
        transactions.withTransaction(async (outer) => {
          await items.create(asA, { name: "外層" }, { session: outer });
          await transactions.withTransaction(async (inner) => {
            expect(inner).toBe(outer);
            await items.create(asA, { name: "內層" }, { session: inner });
            throw new Error("內層錯誤");
          });
        }),
      ).rejects.toThrow("內層錯誤");
      expect(await namesInDatabase()).toEqual(before);
    });
  });

  describe("afterCommit", () => {
    it("交易成功後依登記順序執行;某一個失敗只記 log,不影響後面的與交易結果", async () => {
      const ran: string[] = [];
      const result = await transactions.withTransaction(async (session) => {
        await items.create(asA, { name: "afterCommit-成功" }, { session });
        afterCommit(() => {
          ran.push("第一個");
        });
        afterCommit(() => {
          throw new Error("交易後動作失敗");
        });
        afterCommit(async () => {
          // 交易後動作已不在交易內:可以寄信 / 呼叫外部服務
          expect(currentSession()).toBeUndefined();
          assertOutsideTransaction("寄信");
          await Promise.resolve();
          ran.push("第三個");
        });
        expect(ran).toEqual([]);
        return "ok";
      });

      expect(result).toBe("ok");
      expect(ran).toEqual(["第一個", "第三個"]);
    });

    it("交易回復時不執行", async () => {
      const ran: string[] = [];
      await expect(
        transactions.withTransaction(async (session) => {
          await items.create(asA, { name: "afterCommit-回復" }, { session });
          afterCommit(() => {
            ran.push("不該執行");
          });
          throw new Error("注入錯誤");
        }),
      ).rejects.toThrow("注入錯誤");
      expect(ran).toEqual([]);
    });

    it("寫入衝突自動重試:整個 fn 重跑,被丟掉那一輪登記的動作不執行", async () => {
      const ran: number[] = [];
      let attempt = 0;
      await transactions.withTransaction(async (session) => {
        attempt += 1;
        const current = attempt;
        await items.create(
          asA,
          { name: `重試-${String(current)}` },
          { session },
        );
        afterCommit(() => {
          ran.push(current);
        });
        if (current === 1) {
          throw transientError();
        }
      });

      expect(attempt).toBe(2);
      expect(ran).toEqual([2]);
      const names = await namesInDatabase();
      expect(names).toContain("重試-2");
      expect(names).not.toContain("重試-1");
    });

    it("不在交易內呼叫即拋錯", () => {
      expect(() => {
        afterCommit(() => {
          /* 不會被登記 */
        });
      }).toThrow("afterCommit 只能在");
    });
  });

  it("超過上限即中止並回復", async () => {
    const before = await namesInDatabase();
    await expect(
      transactions.withTransaction(
        async (session) => {
          await items.create(asA, { name: "逾時" }, { session });
          await new Promise((resolve) => setTimeout(resolve, 300));
          await items.create(asA, { name: "逾時-2" }, { session });
        },
        { timeoutMs: 100 },
      ),
    ).rejects.toThrow();
    expect(await namesInDatabase()).toEqual(before);
  });

  describe("帶 session 時租戶保底仍生效", () => {
    it("交易內讀不到別租戶的資料(明確帶 session 與自動加入都一樣)", async () => {
      const ofB = await items.create(asB, { name: "B 租戶的資料" });

      await transactions.withTransaction(async (session) => {
        await expect(
          items.findById(asA, ofB._id, { session }),
        ).resolves.toBeNull();
        await expect(
          items.findOne(asA, { name: "B 租戶的資料" }, { session }),
        ).resolves.toBeNull();
        await expect(
          items.findMany(asA, { name: "B 租戶的資料" }, { session }),
        ).resolves.toEqual([]);
        await expect(
          items.count(asA, { name: "B 租戶的資料" }, { session }),
        ).resolves.toBe(0);
        await expect(items.findById(asA, ofB._id)).resolves.toBeNull();
        // 寫也一樣:可見範圍外的資料視為不存在
        await expect(
          items.updateById(
            asA,
            ofB._id,
            { $set: { name: "被 A 改掉" } },
            { session },
          ),
        ).resolves.toBeNull();
        await expect(
          items.softDeleteById(asA, ofB._id, { session }),
        ).resolves.toBeNull();
        // 同一筆對 B 自己看得到(確認不是資料不存在)
        await expect(
          items.findById(asB, ofB._id, { session }),
        ).resolves.toMatchObject({ name: "B 租戶的資料" });
      });

      await expect(items.findById(asB, ofB._id)).resolves.toMatchObject({
        name: "B 租戶的資料",
        deletedAt: null,
      });
    });
  });

  describe("交易內不得有外部副作用(執行期斷言)", () => {
    it("交易內寄信 → 拋錯,且整個交易回復", async () => {
      const mail = new RecordingMailService({
        resendApiKey: undefined,
        allowlist: [],
      });
      const before = await namesInDatabase();
      await expect(
        transactions.withTransaction(async (session) => {
          await items.create(asA, { name: "寄信前" }, { session });
          await mail.sendActivationEmail({
            to: "someone@example.com",
            name: "某人",
            link: "https://example.com/activate",
            expiresAt: new Date(),
          });
        }),
      ).rejects.toThrow("交易內不得寄信");
      expect(mail.sent).toEqual([]);
      expect(await namesInDatabase()).toEqual(before);
    });

    it("排到 afterCommit 的寄信照常寄出", async () => {
      const mail = new RecordingMailService({
        resendApiKey: undefined,
        allowlist: [],
      });
      await transactions.withTransaction(async (session) => {
        await items.create(asA, { name: "交易後寄信" }, { session });
        afterCommit(() =>
          mail.sendActivationEmail({
            to: "someone@example.com",
            name: "某人",
            link: "https://example.com/activate",
            expiresAt: new Date(),
          }),
        );
      });
      expect(mail.sent).toHaveLength(1);
    });

    it("交易外呼叫斷言不拋錯", () => {
      expect(() => {
        assertOutsideTransaction("呼叫 HTTP");
      }).not.toThrow();
    });
  });
});
