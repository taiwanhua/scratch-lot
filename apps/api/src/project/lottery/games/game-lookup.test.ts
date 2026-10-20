import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  FORM_LOOKUP,
  FORM_TEST_TIMEOUT_MS,
  M,
  assignForm,
  call,
  createOperator,
  definitionOf,
  field,
  publishNewForm,
  rootToken,
} from "../../../forms/test-support/form-fixtures";
import {
  LOTTERY_GAMES_COLLECTION,
  MASTER_DATA_MODULE_KEY,
} from "../../database/lottery-games/lottery-game.schema";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface LookupData {
  formLookup: {
    items: { id: string; label: string; values: Record<string, unknown> }[];
    totalCount: number;
  };
}

const FORM = "lottery_game_lookup_form";

/** 叫貨單 / 進貨單的用法:引用遊戲、固定條件只列販售中;另一欄不帶條件(對照)。 */
const formDefinition = (): FormDefinition =>
  definitionOf([
    field("title", "text"),
    field("game", "reference", {
      source: {
        provider: "lottery_game",
        labelField: "name",
        filter: { status: "on_sale" },
      },
    }),
    field("any_game", "reference", {
      source: { provider: "lottery_game", labelField: "name" },
    }),
  ]);

/**
 * lookup 來源 `lottery_game`(專案規格 5.1、底座 B2a):經真的 `formLookup` 端點查。
 * 「只列販售中」= 表單定義帶 `filter: { status: "on_sale" }`(來源宣告 `status` 可當固定條件)。
 */
describe("lookup 來源 lottery_game", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let staffA: string;
  /** 只屬於甲分店(租戶可見性預設 own):看不到掛在最上層組織的遊戲。 */
  let branchStaffA: string;

  async function insertGame(
    orgId: Types.ObjectId,
    game: { gameCode: string; name: string; status: string },
  ): Promise<void> {
    const now = new Date();
    await api.connection.collection(LOTTERY_GAMES_COLLECTION).insertOne({
      ...game,
      unitPrice: 100,
      ticketsPerBook: 100,
      bookPrice: 10_000,
      defaultRate: 92,
      color: null,
      launchedAt: null,
      discontinuedAt: null,
      claimDeadline: null,
      note: null,
      orgId,
      tenantId: orgId,
      moduleKey: MASTER_DATA_MODULE_KEY,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
  }

  async function labels(
    target: Record<string, unknown>,
    token = staffA,
  ): Promise<string[]> {
    const result = await call<LookupData>(api, token, FORM_LOOKUP, {
      input: { formKey: FORM, version: 1, target, keyword: null },
    });
    expect(result.errors).toBeUndefined();
    return result.data?.formLookup.items.map((item) => item.label) ?? [];
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-game-lookup");
    const root = await rootToken(api);
    tenantA = await createOrg(api.connection, { name: "租戶甲" });
    const tenantB = await createOrg(api.connection, { name: "租戶乙" });
    await publishNewForm(api, root, FORM, formDefinition());
    await assignForm(api, root, FORM, [tenantA]);
    const staff = await createOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [M.view, M.create],
    });
    staffA = staff.token;
    const branchA = await createOrg(api.connection, {
      name: "甲分店",
      parentId: tenantA,
    });
    const branchStaff = await createOperator(api, api.connection, {
      orgId: branchA,
      ownerOrgId: tenantA,
      permissionKeys: [M.view, M.create],
    });
    branchStaffA = branchStaff.token;
    await insertGame(tenantA, {
      gameCode: "5201",
      name: "金好運",
      status: "on_sale",
    });
    await insertGame(tenantA, {
      gameCode: "4980",
      name: "舊彩",
      status: "discontinued",
    });
    await insertGame(tenantB, {
      gameCode: "5300",
      name: "乙的遊戲",
      status: "on_sale",
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("帶「只列販售中」條件:只回販售中的遊戲(停售的不出現),別租戶的也不出現", async () => {
    expect(await labels({ fieldKey: "game" })).toEqual(["金好運"]);
  });

  it("對照:不帶條件時停售的也列(依值取回舊單據要讀得到)", async () => {
    expect(await labels({ fieldKey: "any_game" })).toEqual(["舊彩", "金好運"]);
  });

  it("現況:只屬於分店的人查不到遊戲(lookup 範圍 = 可見範圍,遊戲掛在最上層組織;待決定,改了範圍這個測試跟著改)", async () => {
    expect(await labels({ fieldKey: "game" }, branchStaffA)).toEqual([]);
  });
});
