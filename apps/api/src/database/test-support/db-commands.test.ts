import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";

import {
  countDbCommands,
  describeDbCommands,
  expectDbCommandsAtMost,
} from "./db-commands";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./mongo-connection";

/** 開發者自己開的 debug(測試結束後要還原成它)。 */
function developerDebug(): void {
  /* 開發者自己的 debug */
}

/** 防退化測試的指令計數(TX-06):逐筆讀與一次讀的差別要數得出來。 */
describe("countDbCommands", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-db-commands");
    await database.connection
      .collection("probe_items")
      .insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  it("逐筆讀 = 筆數次;一次 $in 讀 = 1 次;分項列出集合與方法", async () => {
    const items = database.connection.collection("probe_items");
    const each = await countDbCommands(async () => {
      for (const n of [1, 2, 3]) {
        await items.findOne({ n });
      }
    });
    const batch = await countDbCommands(() =>
      items.find({ n: { $in: [1, 2, 3] } }).toArray(),
    );
    expect(each.total).toBe(3);
    expect(batch.total).toBe(1);
    expect(batch.result).toHaveLength(3);
    expect(describeDbCommands(each.byCommand)).toContain(
      "probe_items.findOne: 3",
    );
  });

  it("超過上限 → 拋錯並列出分項;結束後(含拋錯)不再計數", async () => {
    const items = database.connection.collection("probe_items");
    await expect(
      countDbCommands(async () => {
        await items.findOne({ n: 1 });
        throw new Error("中途失敗");
      }),
    ).rejects.toThrow("中途失敗");
    const counted = await countDbCommands(() => items.findOne({ n: 2 }));
    expect(counted.total).toBe(1);
    expect(() => {
      expectDbCommandsAtMost(
        { total: 5, byCommand: new Map([["probe_items.findOne", 5]]) },
        4,
        "逐筆讀",
      );
    }).toThrow(
      /逐筆讀:資料庫指令 5 次,超過上限 4[\s\S]*probe_items\.findOne: 5/,
    );
    expect(() => {
      expectDbCommandsAtMost(counted, 1, "一次讀");
    }).not.toThrow();
  });

  it("結束時還原原本的 debug 設定(開發者自己開的不被蓋掉)", async () => {
    mongoose.set("debug", developerDebug);
    try {
      await countDbCommands(() =>
        database.connection.collection("probe_items").findOne({ n: 1 }),
      );
      expect(mongoose.get("debug")).toBe(developerDebug);
    } finally {
      mongoose.set("debug", false);
    }
  });
});
