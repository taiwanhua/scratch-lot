import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Model, Types } from "mongoose";

import { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { TenantScopeError } from "../database/plugins/tenant-scope.plugin";
import { Org, OrgSchema } from "../database/schemas/org.schema";
import {
  SerialCounter,
  SerialCounterSchema,
} from "../database/schemas/serial-counter.schema";
import { SerialCountersStore } from "../database/serial-counters.store";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "../database/test-support/mongo-connection";
import { TransactionService } from "../database/transaction";
import { SerialService } from "./serial.service";

const root = new Types.ObjectId();
const T = new Types.ObjectId();
const B1 = new Types.ObjectId();
const B2 = new Types.ObjectId();
const U = new Types.ObjectId();
const U1 = new Types.ObjectId();

function staffOf(orgId: Types.ObjectId): OperatorContext {
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [],
    memberOrgIds: [orgId],
    roleIds: [],
    memberTenants: [],
  };
}

const MONTHLY = { prefix: "PU", period: "month", digits: 4 } as const;

/** 單號(`SerialService`)對真 MongoDB replica set:原子取號、各租戶分開、期間以租戶時區重新起算。 */
describe("SerialService(單號)", () => {
  let database: TestDatabase;
  let serials: SerialService;
  let counters: Model<SerialCounter>;
  let transactions: TransactionService;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-serials");
    await database.connection.collection("orgs").insertMany([
      { _id: root, name: "根", parentId: null, ancestors: [], settings: {} },
      {
        _id: T,
        name: "租戶甲",
        parentId: root,
        ancestors: [root],
        settings: { timezone: "Asia/Taipei" },
      },
      { _id: B1, name: "甲一店", parentId: T, ancestors: [root, T] },
      { _id: B2, name: "甲二店", parentId: T, ancestors: [root, T] },
      {
        _id: U,
        name: "租戶乙",
        parentId: root,
        ancestors: [root],
        settings: { timezone: "UTC" },
      },
      { _id: U1, name: "乙一店", parentId: U, ancestors: [root, U] },
    ]);
    counters = database.connection.model<SerialCounter>(
      SerialCounter.name,
      SerialCounterSchema,
    );
    await counters.init();
    const orgs = new OrgsRepository(
      database.connection.model(Org.name, OrgSchema),
    );
    serials = new SerialService(new SerialCountersStore(counters), orgs);
    transactions = new TransactionService(database.connection);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  const october = new Date("2026-10-15T04:00:00Z");

  it("同時取號 20 次:不重複、連號 1–20", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        serials.next(staffOf(B1), "concurrent", MONTHLY, { at: october }),
      ),
    );
    expect(new Set(results).size).toBe(20);
    expect(results.toSorted((a, b) => a.localeCompare(b))).toEqual(
      Array.from(
        { length: 20 },
        (_unused, index) => `PU-202610-${String(index + 1).padStart(4, "0")}`,
      ),
    );
  });

  it("同一租戶不同分店共用一組流水號;兩個租戶各自從 1 起", async () => {
    expect(
      await serials.next(staffOf(B1), "tenants", MONTHLY, { at: october }),
    ).toBe("PU-202610-0001");
    expect(
      await serials.next(staffOf(B2), "tenants", MONTHLY, { at: october }),
    ).toBe("PU-202610-0002");
    expect(
      await serials.next(staffOf(U1), "tenants", MONTHLY, { at: october }),
    ).toBe("PU-202610-0001");
  });

  it("跨月重新起算,期間以租戶時區切(UTC 10/31 16:30 在台北已是 11 月、在 UTC 還是 10 月)", async () => {
    const lateOctoberUtc = new Date("2026-10-31T16:30:00Z");
    expect(
      await serials.next(staffOf(B1), "monthly", MONTHLY, { at: october }),
    ).toBe("PU-202610-0001");
    expect(
      await serials.next(staffOf(B1), "monthly", MONTHLY, {
        at: lateOctoberUtc,
      }),
    ).toBe("PU-202611-0001");
    expect(
      await serials.next(staffOf(U1), "monthly", MONTHLY, {
        at: lateOctoberUtc,
      }),
    ).toBe("PU-202610-0001");
    expect(
      await serials.next(
        staffOf(B1),
        "yearly",
        { prefix: "Y", period: "year", digits: 3 },
        { at: october },
      ),
    ).toBe("Y-2026-001");
    expect(
      await serials.next(
        staffOf(B1),
        "never",
        { prefix: "N", period: "none", digits: 2, separator: "" },
        { at: october },
      ),
    ).toBe("N01");
  });

  it("交易回復時這次取的號也回復(下一次還是同一號)", async () => {
    await expect(
      transactions.withTransaction(async () => {
        await serials.next(staffOf(B1), "rollback", MONTHLY, { at: october });
        throw new Error("後續失敗");
      }),
    ).rejects.toThrow("後續失敗");
    expect(
      await serials.next(staffOf(B1), "rollback", MONTHLY, { at: october }),
    ).toBe("PU-202610-0001");
  });

  it("單據歸屬組織不在可見範圍、或沒有組織 → TenantScopeError", async () => {
    await expect(
      serials.next(staffOf(B1), "scope", MONTHLY, { orgId: B2 }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      serials.next({ ...staffOf(B1), currentOrgId: null }, "scope", MONTHLY),
    ).rejects.toThrow(TenantScopeError);
  });
});
