import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import {
  MANUAL_SALE_SCAN_FAILED,
  MANUAL_SALE_SYSTEM_BACKFILL,
  SALE_REVERSAL_CUSTOMER_RETURN,
  WITHDRAW_OPENING_FLOAT,
} from "@repo/domain/project/lottery-fields";

import {
  SEED_ENTRY,
  TestMongo,
  documentsOf,
  startEntry,
  withDatabase,
} from "../../test/support/update-harness";
import { PROJECT_FIELD_CATEGORIES } from "./field-categories";
import { projectSeedSource } from "./registry";

/**
 * 專案的欄位管理系統類別(專案規格第 13 章;正本 `docs/modules/project/field-manager.md`)。
 * 期望值逐列抄規格表:類別 key、名稱、選項(標籤依宣告順序)。
 */
const EXPECTED: readonly [key: string, name: string, labels: string[]][] = [
  [
    "lottery-sale-reversal-reason",
    "撤銷售出原因",
    ["客人退貨", "刷錯刮刮樂", "盤點錯誤", "其他"],
  ],
  [
    "lottery-redemption-revoke-reason",
    "撤銷兌獎原因",
    ["登記錯誤", "金額錯誤", "其他"],
  ],
  [
    "lottery-manual-sale-reason",
    "手動標記原因",
    ["刷不到條碼", "系統異常補登", "其他"],
  ],
  [
    "lottery-cash-correction-reason",
    "現金更正原因",
    [
      "員工賠補",
      "客人補付",
      "尋回",
      "退還客人",
      "遺失",
      "假鈔",
      "存款短少",
      "其他",
    ],
  ],
  [
    "lottery-void-reason",
    "作廢原因",
    ["輸入錯誤", "重複建立", "交易取消", "其他"],
  ],
  [
    "lottery-checkout-diff-reason",
    "結帳差額原因",
    ["找錯錢", "兌獎誤付", "審核中的單據", "其他"],
  ],
  [
    "lottery-skip-stocktake-reason",
    "跳過盤點原因",
    ["人力不足", "系統異常", "其他"],
  ],
  ["lottery-withdraw-reason", "出庫原因", ["開班零用金", "補零錢", "其他"]],
  [
    "lottery-lost-reason",
    "遺失原因",
    ["調貨途中遺失", "店內遺失", "原因不明", "其他"],
  ],
  ["lottery-recover-reason", "尋回原因", ["盤點找到", "調貨送錯", "其他"]],
  ["lottery-scrap-reason", "報廢原因", ["破損", "污損", "其他"]],
  ["schedule-position", "崗位", ["店內櫃台", "店外攤位", "補貨"]],
  ["schedule-task", "執行任務", ["店內事務與帳目負責", "店內事務"]],
  [
    "schedule-change-reason",
    "排班異動原因",
    ["臨時請假", "換班", "病假", "其他"],
  ],
  [
    "schedule-makeup-punch-reason",
    "補打卡原因",
    ["忘記打卡", "裝置故障", "其他"],
  ],
  [
    "schedule-day-off-override-reason",
    "代改畫休原因",
    ["員工臨時告知", "登記錯誤", "店務調整", "其他"],
  ],
  [
    "schedule-entry-reassign-reason",
    "改對應排班原因",
    ["開班時選錯排班", "臨時代班補排班後改對應", "換班", "其他"],
  ],
  [
    "lottery-skip-correction-reason",
    "更正跳號原因",
    ["標註錯誤", "張號看錯", "其他"],
  ],
  [
    "schedule-special-day-category",
    "特殊日類別",
    ["國定假日", "颱風假", "活動日", "其他"],
  ],
];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionValues = (categoryKey: string): string[] =>
  PROJECT_FIELD_CATEGORIES.find(
    (category) => category.key === categoryKey,
  )?.options.map((option) => option.value) ?? [];

describe("專案欄位管理類別的宣告(第 13 章)", () => {
  it("19 個類別(含崗位),key、名稱、選項標籤與順序同規格表", () => {
    expect(
      PROJECT_FIELD_CATEGORIES.map(({ key, name, options }) => [
        key,
        name,
        options.map((option) => option.label),
      ]),
    ).toEqual(EXPECTED);
  });

  it("選項 value 一律英文 kebab-case、同類別不重複;「其他」一律 other 且排最後", () => {
    for (const category of PROJECT_FIELD_CATEGORIES) {
      const values = category.options.map((option) => option.value);
      for (const value of values) {
        expect(value).toMatch(KEBAB);
      }
      expect(new Set(values).size).toBe(values.length);
      const otherIndex = category.options.findIndex(
        (option) => option.label === "其他",
      );
      if (otherIndex !== -1) {
        expect(category.options[otherIndex]?.value).toBe("other");
        expect(otherIndex).toBe(category.options.length - 1);
      }
    }
  });

  it("程式要認得的選項代碼都在對應類別裡(客人退貨、刷不到條碼、系統異常補登、開班零用金)", () => {
    expect(optionValues("lottery-sale-reversal-reason")).toContain(
      SALE_REVERSAL_CUSTOMER_RETURN,
    );
    expect(optionValues("lottery-manual-sale-reason").slice(0, 2)).toEqual([
      MANUAL_SALE_SCAN_FAILED,
      MANUAL_SALE_SYSTEM_BACKFILL,
    ]);
    expect(optionValues("lottery-withdraw-reason")).toContain(
      WITHDRAW_OPENING_FLOAT,
    );
    expect([
      SALE_REVERSAL_CUSTOMER_RETURN,
      MANUAL_SALE_SCAN_FAILED,
      MANUAL_SALE_SYSTEM_BACKFILL,
    ]).toEqual(["customer-return", "scan-failed", "system-backfill"]);
  });

  it("登記在專案種子來源", () => {
    const collections = projectSeedSource.seeds.map((set) =>
      set.kind === "documents" ? set.collection : set.kind,
    );
    expect(collections).toEqual(
      expect.arrayContaining([
        "field_categories",
        "fields",
        "project_field_option_colors",
      ]),
    );
  });
});

const mongo = new TestMongo("db-migrator-project-fields");

beforeAll(async () => {
  await mongo.start();
}, 60_000);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("正式 registry 的 seed:專案類別落庫且冪等", () => {
  it("seed 後 19 個專案系統類別與它們的全域選項都在(orgId = null);重跑不增加、id 不動", async () => {
    const databaseUri = mongo.uri("fresh");
    const first = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);

    const projectKeys = new Set(EXPECTED.map(([key]) => key));
    const readProject = async () => {
      const allCategories = await documentsOf(databaseUri, "field_categories", {
        isSystem: true,
      });
      const categories = allCategories.filter((category) =>
        projectKeys.has(String(category.key)),
      );
      const categoryIds = new Set(categories.map(({ _id }) => String(_id)));
      const allFields = await documentsOf(databaseUri, "fields", {
        isSystem: true,
      });
      const fields = allFields.filter((field) =>
        categoryIds.has(String(field.categoryId)),
      );
      return { categories, fields };
    };

    const seeded = await readProject();
    expect(seeded.categories).toHaveLength(19);
    const totalOptions = EXPECTED.reduce(
      (sum, expected) => sum + expected[2].length,
      0,
    );
    expect(seeded.fields).toHaveLength(totalOptions);
    for (const field of seeded.fields) {
      expect(field).toMatchObject({ orgId: null, enabled: true });
    }
    const manualSale = seeded.categories.find(
      (category) => category.key === "lottery-manual-sale-reason",
    );
    expect(
      seeded.fields
        .filter((field) => String(field.categoryId) === String(manualSale?._id))
        .map((field): [string, number] => [
          String(field.value),
          Number(field.order),
        ]),
    ).toEqual([
      ["scan-failed", 1],
      ["system-backfill", 2],
      ["other", 3],
    ]);

    const second = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(second.stderr).toBe("");
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(
      /field_categories:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 \d+/,
    );
    expect(second.stdout).toMatch(
      /fields:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 \d+/,
    );

    const again = await readProject();
    expect(again.categories.map(({ _id }) => String(_id))).toEqual(
      seeded.categories.map(({ _id }) => String(_id)),
    );
    expect(again.fields.map(({ _id }) => String(_id))).toEqual(
      seeded.fields.map(({ _id }) => String(_id)),
    );
  }, 300_000);
});

/** 每個有顏色的全域選項(以選項 key 表示)→ 色票代號。 */
async function colorsByKey(databaseUri: string) {
  const fields = await documentsOf(databaseUri, "fields", { isSystem: true });
  const keyOf = new Map(
    fields.map((field) => [String(field._id), String(field.key)]),
  );
  const colors = await documentsOf(databaseUri, "project_field_option_colors");
  return Object.fromEntries(
    colors.map((color) => [
      keyOf.get(String(color.fieldId)) ?? "?",
      color.paletteKey as string | null,
    ]),
  );
}

describe("正式 registry 的 seed:崗位三個全域選項的初始顏色", () => {
  const POSITION_COLORS = {
    "schedule-position.in-store-counter": "blue",
    "schedule-position.outdoor-stall": "green",
    "schedule-position.restock": "orange",
  };

  it("首跑寫入三筆(orgId = 根組織、tenantId = null);重跑冪等;已改過的顏色(改成 red)重跑不覆蓋", async () => {
    const databaseUri = mongo.uri("colors");
    const first = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(first.status).toBe(0);

    const [rootOrg] = await documentsOf(databaseUri, "orgs", { key: "root" });
    const seeded = await documentsOf(
      databaseUri,
      "project_field_option_colors",
    );
    expect(seeded).toHaveLength(3);
    for (const color of seeded) {
      expect(color).toMatchObject({
        orgId: rootOrg?._id as unknown,
        tenantId: null,
        isSystem: true,
      });
    }
    expect(await colorsByKey(databaseUri)).toEqual(POSITION_COLORS);

    const again = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(
      /project_field_option_colors:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 3/,
    );

    // 平台管理員在欄位管理把「補貨」改成 red、把「店外攤位」清成不設定
    await withDatabase(databaseUri, async (database) => {
      const colors = database.collection("project_field_option_colors");
      await colors.updateOne(
        { key: "schedule-position.restock" },
        { $set: { paletteKey: "red" } },
      );
      await colors.updateOne(
        { key: "schedule-position.outdoor-stall" },
        { $set: { paletteKey: null } },
      );
    });
    const afterEdit = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(afterEdit.status).toBe(0);
    expect(await colorsByKey(databaseUri)).toEqual({
      ...POSITION_COLORS,
      "schedule-position.restock": "red",
      "schedule-position.outdoor-stall": null,
    });
  }, 300_000);

  it("seed 之前平台管理員就設過顏色:以 fieldId 認養那一筆,顏色保留,不另建", async () => {
    const databaseUri = mongo.uri("colors-adopt");
    const seeded = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(seeded.status).toBe(0);
    // 模擬 seed 加入顏色之前、人在欄位管理建的那一筆(沒有 key、不是種子)
    await withDatabase(databaseUri, (database) =>
      database
        .collection("project_field_option_colors")
        .updateOne(
          { key: "schedule-position.restock" },
          { $unset: { key: "" }, $set: { isSystem: false, paletteKey: "red" } },
        ),
    );
    const rerun = await startEntry(SEED_ENTRY, [], databaseUri).done;
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toMatch(
      /project_field_option_colors:新增 0 \/ 更新 0 \/ 認養 1/,
    );
    const colors = await documentsOf(
      databaseUri,
      "project_field_option_colors",
    );
    expect(colors).toHaveLength(3);
    expect(await colorsByKey(databaseUri)).toMatchObject({
      "schedule-position.restock": "red",
    });
  }, 300_000);
});
