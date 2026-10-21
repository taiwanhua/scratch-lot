import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Model } from "mongoose";

import { BaseRepository } from "../base.repository";
import type { OperatorContext } from "../operator-context";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "../test-support/mongo-connection";
import { Customer, CustomerSchema } from "./customer.schema";
import { User, UserSchema } from "./user.schema";

/** customers 是租戶資料(ADR-0005),讀取須經 BaseRepository;此處以根組織身分(可見全部)讀。 */
const asRoot: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

let sequence = 0;

/** 產生一組不重複的必填帳號欄位(Customer 為 User 加 orgId 的超集)。 */
function accountFields(overrides: Partial<Customer> = {}): Partial<Customer> {
  sequence += 1;
  const suffix = String(sequence);
  return {
    name: `測試帳號${suffix}`,
    email: `person-${suffix}@example.com`,
    account: `person-${suffix}`,
    // 非真實憑證:純測試佔位字串,代表已雜湊過的值
    passwordHash: `hashed-value-${suffix}`,
    ...overrides,
  };
}

describe("users / customers schema(ADR-0003 / ADR-0007)", () => {
  let database: TestDatabase;
  let userModel: Model<User>;
  let customerModel: Model<Customer>;

  beforeAll(async () => {
    // 欄位級加密金鑰(32 bytes, base64)— 測試自備
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    database = await openTestDatabase("cookhome-test-accounts");
    userModel = database.connection.model<User>(User.name, UserSchema);
    customerModel = database.connection.model<Customer>(
      Customer.name,
      CustomerSchema,
    );
    await userModel.syncIndexes();
    await customerModel.syncIndexes();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  it("users:account 唯一(登入識別)、email 唯一(信件流程定位)", async () => {
    await userModel.create(
      accountFields({ account: "dup-account", email: "a1@example.com" }),
    );
    await expect(
      userModel.create(
        accountFields({ account: "dup-account", email: "a2@example.com" }),
      ),
    ).rejects.toMatchObject({ code: 11_000 });
    await expect(
      userModel.create(
        accountFields({ account: "other-account", email: "a1@example.com" }),
      ),
    ).rejects.toMatchObject({ code: 11_000 });
  });

  it("customers:account / email 同樣唯一,且必填 orgId(單一歸屬組織)", async () => {
    const { Types } = await import("mongoose");
    const orgId = new Types.ObjectId();
    await customerModel.create(
      accountFields({ account: "c-dup", email: "c1@example.com", orgId }),
    );
    await expect(
      customerModel.create(
        accountFields({ account: "c-dup", email: "c2@example.com", orgId }),
      ),
    ).rejects.toMatchObject({ code: 11_000 });

    // orgId 必填(註冊預設根組織由業務層帶入,資料層不允許缺漏)
    await expect(
      customerModel.create(accountFields({ account: "c-no-org" })),
    ).rejects.toThrow(/orgId/);
  });

  it("nationalId 於資料庫為密文存放,不出現明文(ADR-0007 欄位級加密)", async () => {
    const plaintext = "A123456789";
    await userModel.create(
      accountFields({ account: "encrypted-user", nationalId: plaintext }),
    );

    const raw = await database.connection
      .collection("users")
      .findOne({ account: "encrypted-user" });
    const storedValue = raw?.nationalId as string;
    expect(storedValue).toBeDefined();
    expect(storedValue).not.toContain(plaintext);
  });

  it("nationalId 預設投影不回傳;明確 select 才回傳且為解密後明文", async () => {
    const plaintext = "B987654321";
    await userModel.create(
      accountFields({ account: "projection-user", nationalId: plaintext }),
    );

    const byDefault = await userModel
      .findOne({ account: "projection-user" })
      .exec();
    expect(byDefault?.nationalId).toBeUndefined();

    const withSelect = await userModel
      .findOne({ account: "projection-user" })
      .select("+nationalId")
      .exec();
    expect(withSelect?.nationalId).toBe(plaintext);
  });

  it("customers 的 nationalId 同樣加密存放", async () => {
    const { Types } = await import("mongoose");
    const plaintext = "C246813579";
    await customerModel.create(
      accountFields({
        account: "encrypted-customer",
        nationalId: plaintext,
        orgId: new Types.ObjectId(),
      }),
    );

    const raw = await database.connection
      .collection("customers")
      .findOne({ account: "encrypted-customer" });
    expect(raw?.nationalId as string).not.toContain(plaintext);

    const withSelect = await new BaseRepository(customerModel).findOne(
      asRoot,
      { account: "encrypted-customer" },
      { select: "+nationalId" },
    );
    expect(withSelect?.nationalId).toBe(plaintext);
  });
});
