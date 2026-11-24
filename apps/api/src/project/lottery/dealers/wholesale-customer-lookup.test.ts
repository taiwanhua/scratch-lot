import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import { wholesaleCustomerLabel } from "@repo/domain/project/lottery";

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
import { DEALERS_MODULE_KEY } from "../../database/lottery-dealers/lottery-dealer.schema";
import { LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION } from "../../database/lottery-dealers/lottery-wholesale-customer.schema";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface LookupItem {
  id: string;
  label: string;
  values: Record<string, unknown>;
}

const FORM = "lottery_wholesale_customer_lookup_form";

/** 批售單的用法:引用批售客戶、固定條件只列往來中;另一欄不帶條件(對照)。 */
const formDefinition = (): FormDefinition =>
  definitionOf([
    field("title", "text"),
    field("customer", "reference", {
      source: {
        provider: "lottery_wholesale_customer",
        labelField: "label",
        filter: { status: "active" },
      },
    }),
    field("any_customer", "reference", {
      source: { provider: "lottery_wholesale_customer", labelField: "label" },
    }),
  ]);

/** lookup 來源 `lottery_wholesale_customer`(專案規格 21.2、底座 B2a):經真的 `formLookup` 端點查。 */
describe("lookup 來源 lottery_wholesale_customer", () => {
  let api: AuthTestApp;
  let tenantId: Types.ObjectId;
  let branch: Types.ObjectId;
  let staff: string;
  let branchStaff: string;

  async function insert(
    orgId: Types.ObjectId,
    customer: {
      storeName: string;
      phone: string | null;
      status?: string;
      licenseNo?: string;
      contactName?: string;
    },
    sharedTo: Types.ObjectId | null = null,
  ): Promise<void> {
    const now = new Date();
    await api.connection
      .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
      .insertOne({
        licenseNo: null,
        contactName: null,
        status: "active",
        address: null,
        note: null,
        ...customer,
        label: wholesaleCustomerLabel(customer),
        orgId,
        tenantId: orgId,
        shareOrgs:
          sharedTo === null
            ? []
            : [{ orgId: sharedTo, includeDescendants: false }],
        moduleKey: DEALERS_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
  }

  const labels = async (
    fieldKey: string,
    token = staff,
    keyword: string | null = null,
  ): Promise<Set<string>> => {
    const result = await call<{ formLookup: { items: LookupItem[] } }>(
      api,
      token,
      FORM_LOOKUP,
      { input: { formKey: FORM, version: 1, target: { fieldKey }, keyword } },
    );
    expect(result.errors).toBeUndefined();
    return new Set(
      (result.data?.formLookup.items ?? []).map((item) => item.label),
    );
  };

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-wholesale-lookup");
    const root = await rootToken(api);
    tenantId = await createOrg(api.connection, { name: "租戶甲" });
    const otherTenant = await createOrg(api.connection, { name: "租戶乙" });
    branch = await createOrg(api.connection, {
      name: "甲分店",
      parentId: tenantId,
    });
    await publishNewForm(api, root, FORM, formDefinition());
    await assignForm(api, root, FORM, [tenantId]);
    const operator = await createOperator(api, api.connection, {
      orgId: tenantId,
      permissionKeys: [M.view, M.create],
    });
    staff = operator.token;
    const branchOperator = await createOperator(api, api.connection, {
      orgId: branch,
      ownerOrgId: tenantId,
      permissionKeys: [M.view, M.create],
    });
    branchStaff = branchOperator.token;
    await insert(
      tenantId,
      {
        storeName: "好運彩券行",
        phone: "0223456789",
        licenseNo: "12345678",
        contactName: "林大明",
      },
      branch,
    );
    await insert(tenantId, { storeName: "好運彩券行", phone: null });
    await insert(tenantId, {
      storeName: "停用彩券行",
      phone: null,
      status: "inactive",
    });
    await insert(otherTenant, { storeName: "租戶乙的客戶", phone: null });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("選項文字「店名 · 電話」,沒填電話只有店名;只列往來中;別租戶的不出現", async () => {
    expect(await labels("customer")).toEqual(
      new Set(["好運彩券行", "好運彩券行 · 0223456789"]),
    );
    expect(await labels("any_customer")).toEqual(
      new Set(["好運彩券行", "好運彩券行 · 0223456789", "停用彩券行"]),
    );
  });

  it("關鍵字比對店名、電話、證號、聯絡人", async () => {
    for (const keyword of ["0223456789", "12345678", "大明"]) {
      expect(await labels("customer", staff, keyword)).toEqual(
        new Set(["好運彩券行 · 0223456789"]),
      );
    }
  });

  it("總部建的客戶:共用給分店的那一筆分店才選得到", async () => {
    expect(await labels("customer", branchStaff)).toEqual(
      new Set(["好運彩券行 · 0223456789"]),
    );
  });
});
