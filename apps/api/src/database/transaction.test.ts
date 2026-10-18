import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose, { type HydratedDocument, type Model, Types } from "mongoose";

import { RecordingMailService } from "../mail/recording-mail.service";
import { RecordingStorageService } from "../storage/recording-storage.service";
import { BaseRepository } from "./base.repository";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { RelationService } from "./relation.service";
import {
  CoreRelationship,
  CoreRelationshipSchema,
} from "./schemas/core-relationship.schema";
import { DemoItemOne, DemoItemOneSchema } from "./schemas/demo-item-one.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";
import {
  TransactionService,
  TransactionTimeoutError,
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

    it("巢狀呼叫加入外層交易:內層的錯誤往外拋,外層先寫的也一起回復", async () => {
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

  it("專屬 repository 那種不經 BaseRepository 的 Mongoose 寫入(save / insertMany / updateOne)沒帶 session 也加入交易", async () => {
    const plain = database.connection.model(
      "TransactionPlain",
      new mongoose.Schema({ name: String }),
      "transaction_plain",
    );
    await plain.init();
    await plain.create({ name: "既有" });

    await expect(
      transactions.withTransaction(async () => {
        await new plain({ name: "save" }).save();
        await plain.insertMany([{ name: "insertMany" }]);
        await plain.updateOne({ name: "既有" }, { $set: { name: "改掉" } });
        throw new Error("注入錯誤");
      }),
    ).rejects.toThrow("注入錯誤");

    const remaining = await plain.find({}, { name: 1 }).lean();
    expect(remaining.map((document) => document.name)).toEqual(["既有"]);
  });

  it("巢狀呼叫沒有獨立回復點:內層拋錯被外層接住後繼續,內層的寫入隨外層一起提交", async () => {
    await transactions.withTransaction(async (outer) => {
      await items.create(asA, { name: "巢狀-外層" }, { session: outer });
      await transactions
        .withTransaction(async (inner) => {
          await items.create(asA, { name: "巢狀-內層" }, { session: inner });
          throw new Error("內層錯誤");
        })
        .catch(ignoreError);
    });
    expect(await namesInDatabase()).toEqual(
      expect.arrayContaining(["巢狀-外層", "巢狀-內層"]),
    );
  });

  describe("交易結束後 scope 關閉", () => {
    it("fn 裡排出去、晚於交易結束才跑的工作不再被當成在交易內", async () => {
      const seen: {
        session: unknown;
        afterCommitThrows: boolean;
        assertThrows: boolean;
      }[] = [];
      let late: Promise<void> | undefined;

      await transactions.withTransaction(async (session) => {
        await items.create(asA, { name: "晚到-交易內" }, { session });
        late = new Promise<void>((resolve) => {
          setTimeout(() => {
            seen.push({
              session: currentSession(),
              afterCommitThrows: throws(registerNoopAfterCommit),
              assertThrows: throws(assertMailAllowed),
            });
            // 交易已結束:BaseRepository 不得沿用已結束的 session
            void items.create(asA, { name: "晚到-交易後" }).then(() => {
              resolve();
            });
          }, 50);
        });
      });

      await late;
      expect(seen).toEqual([
        { session: undefined, afterCommitThrows: true, assertThrows: false },
      ]);
      expect(await namesInDatabase()).toEqual(
        expect.arrayContaining(["晚到-交易內", "晚到-交易後"]),
      );
    });

    it("driver 已提交、withTransaction 還沒返回的空檔裡,晚到的工作已在交易外", async () => {
      // 模擬慢機器:伺服器提交完成後,driver / Mongoose 收尾再拖 150ms 才讓 withTransaction 返回
      const committed = deferred();
      const startSession = database.connection.startSession.bind(
        database.connection,
      );
      const slowCommit = jest
        .spyOn(database.connection, "startSession")
        .mockImplementation(async (options?: mongoose.ClientSessionOptions) => {
          const session = await startSession(options);
          const commit = session.commitTransaction.bind(session);
          session.commitTransaction = async (...args) => {
            await commit(...args);
            committed.resolve();
            await new Promise((resolve) => setTimeout(resolve, 150));
          };
          return session;
        });

      const seen: {
        session: unknown;
        afterCommitThrows: boolean;
        assertThrows: boolean;
        writeError: string | undefined;
      }[] = [];
      let late: Promise<void> | undefined;
      try {
        await transactions.withTransaction(async (session) => {
          await items.create(asA, { name: "空檔-交易內" }, { session });
          late = committed.promise.then(async () => {
            const entry = {
              session:
                currentSession() === undefined
                  ? undefined
                  : "仍拿到交易 session",
              afterCommitThrows: throws(registerNoopAfterCommit),
              assertThrows: throws(assertMailAllowed),
              writeError: undefined as string | undefined,
            };
            // 交易已提交:BaseRepository 不得沿用已提交的 session
            await items
              .create(asA, { name: "空檔-交易後" })
              .catch((error: unknown) => {
                entry.writeError =
                  error instanceof Error ? error.message : String(error);
              });
            seen.push(entry);
          });
        });
      } finally {
        slowCommit.mockRestore();
      }

      await late;
      expect(seen).toEqual([
        {
          session: undefined,
          afterCommitThrows: true,
          assertThrows: false,
          writeError: undefined,
        },
      ]);
      expect(await namesInDatabase()).toEqual(
        expect.arrayContaining(["空檔-交易內", "空檔-交易後"]),
      );
    });

    it("自動重試的每一輪(含還沒有任何讀寫時)都算在交易內;afterCommit 在交易外執行", async () => {
      const seen: { attempt: number; inside: boolean; active: boolean }[] = [];
      let afterCommitSession: unknown = "未執行";
      let nestedOuterSession: unknown;
      let attempt = 0;
      await transactions.withTransaction(async (session) => {
        attempt += 1;
        seen.push({
          attempt,
          inside: currentSession() === session,
          active: session.inTransaction(),
        });
        await items.create(
          asA,
          { name: `每輪-${String(attempt)}` },
          { session },
        );
        seen.push({
          attempt,
          inside: currentSession() === session,
          active: session.inTransaction(),
        });
        if (attempt === 1) {
          throw transientError();
        }
        afterCommit(async () => {
          afterCommitSession = currentSession();
          // 交易後動作裡開的交易是新的獨立交易,不會加入已提交的那個
          await transactions.withTransaction(async (next) => {
            nestedOuterSession = next === session ? "同一個" : "新的";
            expect(currentSession()).toBe(next);
            await items.create(asA, { name: "每輪-交易後的新交易" });
          });
        });
      });

      expect(seen).toEqual([
        { attempt: 1, inside: true, active: true },
        { attempt: 1, inside: true, active: true },
        { attempt: 2, inside: true, active: true },
        { attempt: 2, inside: true, active: true },
      ]);
      expect(afterCommitSession).toBeUndefined();
      expect(nestedOuterSession).toBe("新的");
      const names = await namesInDatabase();
      expect(names).toEqual(
        expect.arrayContaining(["每輪-2", "每輪-交易後的新交易"]),
      );
      expect(names).not.toContain("每輪-1");
    });
  });

  describe("兩個交易並行", () => {
    it("隔離:另一個交易看不到尚未提交的寫入,提交後才看得到", async () => {
      const written = deferred();
      const gate = deferred();

      const first = transactions.withTransaction(async (session) => {
        await items.create(asA, { name: "並行-未提交" }, { session });
        written.resolve();
        await gate.promise;
      });
      await written.promise;

      await transactions.withTransaction(async (session) => {
        await expect(
          items.findOne(asA, { name: "並行-未提交" }, { session }),
        ).resolves.toBeNull();
      });
      await expect(
        items.findOne(asA, { name: "並行-未提交" }),
      ).resolves.toBeNull();

      gate.resolve();
      await first;
      await expect(
        items.findOne(asA, { name: "並行-未提交" }),
      ).resolves.not.toBeNull();
    });

    it("真實寫入衝突:後到的交易拿到 WriteConflict 自動重試,先到的提交後寫入成功", async () => {
      const target = await items.create(asA, { name: "衝突-初始" });
      const written = deferred();
      const gate = deferred();

      const first = transactions.withTransaction(async (session) => {
        await items.updateById(
          asA,
          target._id,
          { $set: { name: "衝突-先到" } },
          { session },
        );
        written.resolve();
        await gate.promise;
      });
      await written.promise;

      let attempts = 0;
      await transactions.withTransaction(async (session) => {
        attempts += 1;
        try {
          await items.updateById(
            asA,
            target._id,
            { $set: { name: "衝突-後到" } },
            { session },
          );
        } finally {
          // 第一次嘗試撞到先到交易的鎖(WriteConflict)之後,才讓先到的提交
          if (attempts === 1) {
            gate.resolve();
          }
        }
      });
      await first;

      expect(attempts).toBeGreaterThanOrEqual(2);
      await expect(items.findById(asA, target._id)).resolves.toMatchObject({
        name: "衝突-後到",
      });
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

  describe("超過上限", () => {
    it("fn 跑完已超過上限 → 不提交,整個回復", async () => {
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
      ).rejects.toBeInstanceOf(TransactionTimeoutError);
      expect(await namesInDatabase()).toEqual(before);
    });

    it("寫入衝突重試時已超過上限 → 不再重跑 fn", async () => {
      let attempt = 0;
      await expect(
        transactions.withTransaction(
          async (session) => {
            attempt += 1;
            await items.create(asA, { name: "逾時重試" }, { session });
            await new Promise((resolve) => setTimeout(resolve, 300));
            throw transientError();
          },
          { timeoutMs: 100 },
        ),
      ).rejects.toBeInstanceOf(TransactionTimeoutError);
      expect(attempt).toBe(1);
      expect(await namesInDatabase()).not.toContain("逾時重試");
    });
  });

  /**
   * driver 一批預設回 101 筆,超過就要再發 getMore。交易帶 `timeoutMS` 時(mongodb 7.5),
   * getMore 會被加上 `maxTimeMS`,server 拒絕(non-awaitData cursor 不能帶);回歸測試。
   */
  describe("交易內讀超過一批(> 101 筆,需要 getMore)", () => {
    const BEYOND_FIRST_BATCH = 150;
    let relations: RelationService;
    const memberOrgId = new Types.ObjectId();

    beforeAll(async () => {
      await model.insertMany(
        Array.from({ length: BEYOND_FIRST_BATCH }, (_, index) => ({
          orgId: orgA,
          name: `多批-${String(index).padStart(3, "0")}`,
        })),
      );
      const relationModel = database.connection.model<CoreRelationship>(
        CoreRelationship.name,
        CoreRelationshipSchema,
      );
      await relationModel.init();
      relations = new RelationService(relationModel);
      await relationModel.insertMany(
        Array.from({ length: BEYOND_FIRST_BATCH }, () => ({
          type: "org_user",
          firstId: memberOrgId,
          secondId: new Types.ObjectId(),
        })),
      );
    }, HOOK_TIMEOUT_MS);

    it("BaseRepository.findMany 讀得到全部", async () => {
      const found = await transactions.withTransaction((session) =>
        items.findMany(asA, { name: { $regex: /^多批-/ } }, { session }),
      );
      expect(found).toHaveLength(BEYOND_FIRST_BATCH);
    });

    it("RelationService.listLinks(沒帶 session、自動加入交易)讀得到全部", async () => {
      const links = await transactions.withTransaction(() =>
        relations.listLinks("org_user", { firstIds: [memberOrgId] }),
      );
      expect(links).toHaveLength(BEYOND_FIRST_BATCH);
    });
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

    it("交易內刪除 / 複製 GCS 物件 → 拋錯,交易後照常執行", async () => {
      const storage = new RecordingStorageService({
        privateBucket: undefined,
        publicBucket: undefined,
        signedUrlTtlMs: 60_000,
      });
      const objectPath = "org-logos/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png";

      await expect(
        transactions.withTransaction(() => storage.deleteObject(objectPath)),
      ).rejects.toThrow("交易內不得刪除 GCS 物件");
      await expect(
        transactions.withTransaction(() =>
          storage.copyPrivateObject(objectPath),
        ),
      ).rejects.toThrow("交易內不得複製 GCS 物件");
      expect(storage.deleted).toEqual([]);
      expect(storage.copied).toEqual([]);

      await transactions.withTransaction(async (session) => {
        await items.create(asA, { name: "交易後刪檔" }, { session });
        afterCommit(() => storage.deleteObject(objectPath));
      });
      expect(storage.deleted).toEqual([objectPath]);
    });

    it("交易外呼叫斷言不拋錯", () => {
      expect(() => {
        assertOutsideTransaction("呼叫 HTTP");
      }).not.toThrow();
    });
  });
});

function throws(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

function ignoreError(): void {
  // 刻意吞掉內層錯誤,驗證沒有獨立回復點
}

function registerNoopAfterCommit(): void {
  afterCommit(ignoreError);
}

function assertMailAllowed(): void {
  assertOutsideTransaction("寄信");
}

/** 可以從外部 resolve 的 promise(控制兩個並行交易的先後)。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = ignoreError;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
