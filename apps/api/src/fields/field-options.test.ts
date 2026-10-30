import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { GraphQLError } from "graphql";
import { Types } from "mongoose";

import { REASON_OPTION_OTHER } from "@repo/domain/form";

import { OperatorContextService } from "../auth/operator-context.service";
import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import type { OperatorContext } from "../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { FieldOptionsService } from "./field-options.service";

/** 底座 seed 的「補印原因」類別(全域選項 lost / damaged / other)。 */
const CATEGORY = "reprint-reason";
const ALLOWED = [CATEGORY];

function fieldsOfError(error: unknown): unknown {
  return error instanceof GraphQLError &&
    error.extensions.code === "VALIDATION_FAILED"
    ? error.extensions.fields
    : error;
}

/**
 * 底座的欄位管理選項與原因檢查(`FieldOptionsService`):合併範圍(全域 + 上層 + 自己)、只列啟用、
 * 類別白名單、原因必填 / 有效 / 選「其他」說明必填(真 Mongo)。
 */
describe("FieldOptionsService(業務功能用的選項與原因檢查)", () => {
  let api: AuthTestApp;
  let service: FieldOptionsService;
  let atStore: OperatorContext;

  async function addOption(
    orgId: Types.ObjectId,
    value: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const category = await api.connection
      .collection<{ _id: Types.ObjectId }>("field_categories")
      .findOne({ key: CATEGORY });
    const now = new Date();
    await api.connection.collection("fields").insertOne({
      categoryId: category?._id,
      orgId,
      label: `自訂 ${value}`,
      value,
      order: 50,
      enabled: true,
      isSystem: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      ...overrides,
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-field-options");
    service = api.app.get(FieldOptionsService);
    const tenant = await createOrg(api.connection, { name: "租戶甲" });
    const store = await createOrg(api.connection, {
      name: "一號店",
      parentId: tenant,
    });
    const otherTenant = await createOrg(api.connection, { name: "租戶乙" });
    await addOption(tenant, "tenant-wide", { color: "green" });
    await addOption(store, "store-only");
    await addOption(store, "store-disabled", { enabled: false });
    await addOption(otherTenant, "other-tenant");
    await addOption(store, "legacy-color", { color: "#FFA500" });
    atStore = await api.app
      .get(OperatorContextService)
      .systemOperatorOfOrg(store);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("optionsOf:全域 + 上層 + 自己的啟用選項;別租戶的、停用的不列", async () => {
    const options = await service.optionsOf(atStore, CATEGORY, ALLOWED);
    const values = options.map((option) => option.value);
    expect(values).toEqual(
      expect.arrayContaining([
        "lost",
        "damaged",
        REASON_OPTION_OTHER,
        "tenant-wide",
        "store-only",
      ]),
    );
    expect(values).not.toContain("store-disabled");
    expect(values).not.toContain("other-tenant");
  });

  it("optionsOf 帶選項的顏色:有設的回色票代號,沒設或認不得的代號回 null", async () => {
    const options = await service.optionsOf(atStore, CATEGORY, ALLOWED);
    const colorOf = (value: string) =>
      options.find((option) => option.value === value)?.color;
    expect(colorOf("tenant-wide")).toBe("green");
    expect(colorOf("store-only")).toBeNull();
    expect(colorOf("legacy-color")).toBeNull();
  });

  it("optionMapOf:同一個合併範圍、含停用的(以 enabled 區分),順序與 optionsOf 一致", async () => {
    const map = await service.optionMapOf(atStore, CATEGORY);
    expect(map.get("store-disabled")).toEqual({
      label: "自訂 store-disabled",
      enabled: false,
      color: null,
    });
    expect(map.get("tenant-wide")).toMatchObject({
      enabled: true,
      color: "green",
    });
    expect(map.has("other-tenant")).toBe(false);
    const enabledValues = [...map]
      .filter(([, option]) => option.enabled)
      .map(([value]) => value);
    const listed = await service.optionsOf(atStore, CATEGORY, ALLOWED);
    expect(enabledValues).toEqual(listed.map((option) => option.value));
    const missing = await service.optionMapOf(atStore, "no-such-category");
    expect(missing.size).toBe(0);
  });

  it("categoryKeys:全部類別 key", async () => {
    const keys = await service.categoryKeys(atStore);
    expect(keys.has(CATEGORY)).toBe(true);
    expect(keys.has("no-such-category")).toBe(false);
  });

  it("類別不在呼叫端的白名單 → VALIDATION_FAILED(categoryKey);類別不存在 → 沒有選項", async () => {
    const error: unknown = await service
      .optionsOf(atStore, "gender", ALLOWED)
      .catch((error_: unknown) => error_);
    expect(fieldsOfError(error)).toEqual(["categoryKey"]);
    expect(
      await service.optionsOf(atStore, "no-such-category", [
        "no-such-category",
      ]),
    ).toEqual([]);
  });

  it("assertReason:必填、要是有效選項、選「其他」時說明必填;回選項名稱與去空白的說明", async () => {
    const failOf = (input: {
      reasonKey?: string | null;
      reasonNote?: string;
    }) =>
      service
        .assertReason(atStore, CATEGORY, input, ALLOWED)
        .catch((error_: unknown) => fieldsOfError(error_));
    expect(await failOf({ reasonNote: "x" })).toEqual(["reasonKey"]);
    expect(await failOf({ reasonKey: "other-tenant" })).toEqual(["reasonKey"]);
    expect(await failOf({ reasonKey: "store-disabled" })).toEqual([
      "reasonKey",
    ]);
    expect(
      await failOf({ reasonKey: REASON_OPTION_OTHER, reasonNote: " " }),
    ).toEqual(["reasonNote"]);
    expect(
      await service.assertReason(
        atStore,
        CATEGORY,
        { reasonKey: "store-only", reasonNote: "  " },
        ALLOWED,
      ),
    ).toEqual({
      reasonKey: "store-only",
      reasonLabel: "自訂 store-only",
      reasonNote: null,
    });
    expect(
      await service.assertReason(
        atStore,
        CATEGORY,
        { reasonKey: REASON_OPTION_OTHER, reasonNote: " 改期 " },
        ALLOWED,
      ),
    ).toMatchObject({ reasonKey: REASON_OPTION_OTHER, reasonNote: "改期" });
  });

  it("錯誤欄位名可由呼叫端指定", async () => {
    const error: unknown = await service
      .assertReason(atStore, CATEGORY, {}, ALLOWED, {
        key: "reprintReason",
        note: "reprintNote",
      })
      .catch((error_: unknown) => error_);
    expect(fieldsOfError(error)).toEqual(["reprintReason"]);
  });
});
