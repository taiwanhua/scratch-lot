import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import { MASTER_DATA_PERMISSIONS as P } from "@repo/domain/project/lottery-master-data";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  CASH_POINT_MODULES,
  addCustomPosition,
  createMasterDataOperator,
  errorOf,
  ok,
  seedMasterDataAuthorization,
  seedPositionCategory,
} from "../test-support/master-data-fixtures";
import { registerCashPointDeactivationGuard } from "./cash-point-deactivation";

const FIELDS = /* GraphQL */ `
  fragment TestLotteryCashPointFields on LotteryCashPoint {
    id
    org {
      id
      name
    }
    positionKey
    positionLabel
    name
    order
    enabled
    printer {
      id
      name
    }
    note
    abilities {
      canEdit
    }
  }
`;

const LIST = /* GraphQL */ `
  ${FIELDS}
  query TestLotteryCashPoints($input: LotteryCashPointsInput!) {
    lotteryCashPoints(input: $input) {
      items {
        ...TestLotteryCashPointFields
      }
      totalCount
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query TestLotteryPositionOptions($orgId: ID!) {
    lotteryPositionOptions(orgId: $orgId) {
      items {
        value
        label
      }
      totalCount
    }
  }
`;

const CREATE = /* GraphQL */ `
  ${FIELDS}
  mutation TestCreateLotteryCashPoint($input: CreateLotteryCashPointInput!) {
    createLotteryCashPoint(input: $input) {
      item {
        ...TestLotteryCashPointFields
      }
    }
  }
`;

const UPDATE = /* GraphQL */ `
  ${FIELDS}
  mutation TestUpdateLotteryCashPoint($input: UpdateLotteryCashPointInput!) {
    updateLotteryCashPoint(input: $input) {
      item {
        ...TestLotteryCashPointFields
      }
    }
  }
`;

interface CashPointRow {
  id: string;
  org: { id: string; name: string };
  positionKey: string;
  positionLabel: string | null;
  name: string;
  order: number;
  enabled: boolean;
  printer: { id: string; name: string } | null;
  note: string | null;
  abilities: { canEdit: boolean };
}

interface ListData {
  lotteryCashPoints: { items: CashPointRow[]; totalCount: number };
}

interface OptionsData {
  lotteryPositionOptions: {
    items: { value: string; label: string }[];
    totalCount: number;
  };
}

interface CreateData {
  createLotteryCashPoint: { item: CashPointRow };
}

interface UpdateData {
  updateLotteryCashPoint: { item: CashPointRow };
}

/**
 * 收銀點(專案規格 5.5):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─ 租戶甲 ─┬─ 中山店
 *                        └─ 新竹店。租戶甲自訂崗位「彩券機旁」(掛在租戶頂層,下層分店都選得到)。
 */
describe("檔案管理 → 收銀點(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  /** 租戶甲總部(可見範圍含下層):create + edit。 */
  let manager: string;
  /** 中山店店員:只綁收銀點分頁,沒有寫入權限。 */
  let viewer: string;
  /** 沒綁收銀點分頁。 */
  let outsider: string;
  let printerA: Types.ObjectId;

  function create(input: Record<string, unknown>, token = manager) {
    return ok<CreateData>(api, token, CREATE, { input }).then(
      (data) => data.createLotteryCashPoint.item,
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-cash-points");
    await seedMasterDataAuthorization(api.connection);
    const categoryId = await seedPositionCategory(api.connection);
    tenantA = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    storeA = await createOrg(api.connection, {
      name: "中山店",
      parentId: tenantA,
    });
    storeB = await createOrg(api.connection, {
      name: "新竹店",
      parentId: tenantA,
    });
    await addCustomPosition(api.connection, categoryId, tenantA, {
      value: "lottery-machine",
      label: "彩券機旁",
    });
    manager = await createMasterDataOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys: CASH_POINT_MODULES,
      permissionKeys: [P.cashPointsCreate, P.cashPointsEdit],
    });
    viewer = await createMasterDataOperator(api, api.connection, {
      orgId: storeA,
      ownerOrgId: tenantA,
      moduleKeys: CASH_POINT_MODULES,
      permissionKeys: [],
    });
    outsider = await createMasterDataOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys: [],
      permissionKeys: [],
    });
    const now = new Date();
    const { insertedId } = await api.connection
      .collection("printers")
      .insertOne({
        orgId: storeA,
        agentId: new Types.ObjectId(),
        name: "櫃台收據機",
        host: "printer.local",
        port: 9100,
        paperWidth: 58,
        isDefault: false,
        enabled: true,
        status: null,
        statusAt: null,
        moduleKey: "system.printers",
        tenantId: tenantA,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    printerA = insertedId;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("崗位選單:全域種子 + 上層自訂的,依排序", async () => {
    const data = await ok<OptionsData>(api, manager, OPTIONS, {
      orgId: String(storeA),
    });
    expect(data.lotteryPositionOptions.items).toEqual([
      { value: "in-store-counter", label: "店內櫃台" },
      { value: "outdoor-stall", label: "店外攤位" },
      { value: "restock", label: "補貨" },
      { value: "lottery-machine", label: "彩券機旁" },
    ]);
  });

  it("新增:崗位顯示名、印表機名稱一起回;沒選印表機 = 用分店預設(null)", async () => {
    const withPrinter = await create({
      orgId: String(storeA),
      positionKey: "in-store-counter",
      name: "店內櫃台",
      order: 1,
      printerId: String(printerA),
    });
    expect(withPrinter).toMatchObject({
      org: { id: String(storeA), name: "中山店" },
      positionKey: "in-store-counter",
      positionLabel: "店內櫃台",
      enabled: true,
      printer: { id: String(printerA), name: "櫃台收據機" },
      abilities: { canEdit: true },
    });
    const withoutPrinter = await create({
      orgId: String(storeA),
      positionKey: "lottery-machine",
      name: "彩券機旁",
      order: 3,
    });
    expect(withoutPrinter.printer).toBeNull();
  });

  it("同分店崗位重複 → VALIDATION_FAILED(positionKey);名稱重複 → VALIDATION_FAILED(name);別的分店可以", async () => {
    await create({
      orgId: String(storeA),
      positionKey: "outdoor-stall",
      name: "店外攤位",
    });
    expect(
      await errorOf(api, manager, CREATE, {
        input: {
          orgId: String(storeA),
          positionKey: "outdoor-stall",
          name: "另一個名字",
        },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["positionKey"],
      reason: "POSITION_DUPLICATE",
    });
    expect(
      await errorOf(api, manager, CREATE, {
        input: {
          orgId: String(storeA),
          positionKey: "restock",
          name: "店外攤位",
        },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["name"],
      reason: "NAME_DUPLICATE",
    });
    const other = await create({
      orgId: String(storeB),
      positionKey: "outdoor-stall",
      name: "店外攤位",
    });
    expect(other.org.name).toBe("新竹店");
  });

  it("編輯成與同分店另一筆相同的崗位 / 名稱 → VALIDATION_FAILED", async () => {
    const first = await create({
      orgId: String(storeB),
      positionKey: "in-store-counter",
      name: "新竹櫃台",
    });
    const second = await create({
      orgId: String(storeB),
      positionKey: "restock",
      name: "新竹補貨",
    });
    expect(
      await errorOf(api, manager, UPDATE, {
        input: { id: second.id, positionKey: first.positionKey },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["positionKey"] });
    expect(
      await errorOf(api, manager, UPDATE, {
        input: { id: second.id, name: first.name },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["name"] });
  });

  it("不合法的輸入:崗位不在選單、印表機不是這家分店的、名稱空白", async () => {
    expect(
      await errorOf(api, manager, CREATE, {
        input: {
          orgId: String(storeB),
          positionKey: "no-such-position",
          name: " ",
          printerId: String(printerA),
        },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["name", "positionKey", "printerId"],
    });
  });

  it("不能刪除:schema 沒有刪除端點", async () => {
    const result = await api.graphql(
      /* GraphQL */ `
        mutation {
          deleteLotteryCashPoint(input: { id: "000000000000000000000000" }) {
            success
          }
        }
      `,
      {},
      { accessToken: manager },
    );
    expect(result.errors?.[0]?.message).toContain("deleteLotteryCashPoint");
  });

  describe("停用", () => {
    it("沒有守門登記 → 停用 / 啟用照常", async () => {
      const target = await create({
        orgId: String(storeB),
        positionKey: "lottery-machine",
        name: "新竹彩券機",
      });
      const disabled = await ok<UpdateData>(api, manager, UPDATE, {
        input: { id: target.id, enabled: false },
      });
      expect(disabled.updateLotteryCashPoint.item.enabled).toBe(false);
      const enabled = await ok<UpdateData>(api, manager, UPDATE, {
        input: { id: target.id, enabled: true },
      });
      expect(enabled.updateLotteryCashPoint.item.enabled).toBe(true);
    });

    it("守門回 true → 擋下停用(CASH_POINT_IN_USE);其他欄位照改", async () => {
      const list = await ok<ListData>(api, manager, LIST, {
        input: { orgId: String(storeA) },
      });
      const target = list.lotteryCashPoints.items[0];
      if (!target) {
        throw new Error("前置:中山店沒有收銀點");
      }
      const unregister = registerCashPointDeactivationGuard(
        "test-open-shift",
        (_tenantId, cashPointId) =>
          Promise.resolve(String(cashPointId) === target.id),
      );
      try {
        expect(
          await errorOf(api, manager, UPDATE, {
            input: { id: target.id, enabled: false },
          }),
        ).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["enabled"],
          reason: "CASH_POINT_IN_USE",
        });
        const renamed = await ok<UpdateData>(api, manager, UPDATE, {
          input: { id: target.id, note: "有開著的班" },
        });
        expect(renamed.updateLotteryCashPoint.item).toMatchObject({
          enabled: true,
          note: "有開著的班",
        });
      } finally {
        unregister();
      }
    });
  });

  describe("範圍與權限", () => {
    it("店員只看得到自己分店的,且沒有編輯能力;寫入 FORBIDDEN", async () => {
      const data = await ok<ListData>(api, viewer, LIST, { input: {} });
      const names = new Set(
        data.lotteryCashPoints.items.map((row) => row.org.name),
      );
      expect([...names]).toEqual(["中山店"]);
      expect(
        data.lotteryCashPoints.items.every((row) => !row.abilities.canEdit),
      ).toBe(true);
      expect(
        await errorOf(api, viewer, CREATE, {
          input: {
            orgId: String(storeA),
            positionKey: "restock",
            name: "補貨",
          },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("總部看得到各分店,依分店、排序排", async () => {
      const data = await ok<ListData>(api, manager, LIST, {
        input: { orgId: String(storeA) },
      });
      expect(data.lotteryCashPoints.items.map((row) => row.order)).toEqual(
        [...data.lotteryCashPoints.items.map((row) => row.order)].toSorted(
          (left, right) => left - right,
        ),
      );
    });

    it("沒綁收銀點分頁 → FORBIDDEN", async () => {
      expect(await errorOf(api, outsider, LIST, { input: {} })).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("可見範圍外的分店:選單空、新增 VALIDATION_FAILED(orgId)", async () => {
      const otherTenant = await createOrg(api.connection, { name: "租戶乙" });
      const options = await ok<OptionsData>(api, manager, OPTIONS, {
        orgId: String(otherTenant),
      });
      expect(options.lotteryPositionOptions.totalCount).toBe(0);
      expect(
        await errorOf(api, manager, CREATE, {
          input: {
            orgId: String(otherTenant),
            positionKey: "in-store-counter",
            name: "越界",
          },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["orgId"] });
    });
  });
});
