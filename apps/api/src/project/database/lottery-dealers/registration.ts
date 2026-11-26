import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_DEALER_CONTACTS_COLLECTION,
  LotteryDealerContact,
  LotteryDealerContactSchema,
} from "./lottery-dealer-contact.schema";
import {
  LOTTERY_DEALER_SIGNINS_COLLECTION,
  LotteryDealerSignin,
  LotteryDealerSigninSchema,
} from "./lottery-dealer-signin.schema";
import {
  LOTTERY_DEALERS_COLLECTION,
  LotteryDealer,
  LotteryDealerSchema,
} from "./lottery-dealer.schema";
import {
  LotteryDealerContactsRepository,
  LotteryDealerSigninsRepository,
  LotteryDealersRepository,
  LotteryRelationshipsRepository,
  LotteryWholesaleCustomerLocksRepository,
  LotteryWholesaleCustomersRepository,
} from "./lottery-dealers.repository";
import {
  LOTTERY_RELATIONSHIPS_COLLECTION,
  LotteryRelationship,
  LotteryRelationshipSchema,
} from "./lottery-relationship.schema";
import {
  LOTTERY_WHOLESALE_CUSTOMER_LOCKS_COLLECTION,
  LotteryWholesaleCustomerLock,
  LotteryWholesaleCustomerLockSchema,
} from "./lottery-wholesale-customer-lock.schema";
import {
  LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION,
  LotteryWholesaleCustomer,
  LotteryWholesaleCustomerSchema,
} from "./lottery-wholesale-customer.schema";

/** 經銷商管理的資料登記:六張租戶表、六個 BaseRepository、六項組織歸屬檢查。 */
export const LOTTERY_DEALERS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-dealers",
  models: [
    {
      name: LotteryDealer.name,
      collection: LOTTERY_DEALERS_COLLECTION,
      schema: LotteryDealerSchema,
    },
    {
      name: LotteryDealerContact.name,
      collection: LOTTERY_DEALER_CONTACTS_COLLECTION,
      schema: LotteryDealerContactSchema,
    },
    {
      name: LotteryDealerSignin.name,
      collection: LOTTERY_DEALER_SIGNINS_COLLECTION,
      schema: LotteryDealerSigninSchema,
    },
    {
      name: LotteryRelationship.name,
      collection: LOTTERY_RELATIONSHIPS_COLLECTION,
      schema: LotteryRelationshipSchema,
    },
    {
      name: LotteryWholesaleCustomer.name,
      collection: LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION,
      schema: LotteryWholesaleCustomerSchema,
    },
    {
      name: LotteryWholesaleCustomerLock.name,
      collection: LOTTERY_WHOLESALE_CUSTOMER_LOCKS_COLLECTION,
      schema: LotteryWholesaleCustomerLockSchema,
    },
  ],
  repositories: [
    { modelName: LotteryDealer.name, provider: LotteryDealersRepository },
    {
      modelName: LotteryDealerContact.name,
      provider: LotteryDealerContactsRepository,
    },
    {
      modelName: LotteryDealerSignin.name,
      provider: LotteryDealerSigninsRepository,
    },
    {
      modelName: LotteryRelationship.name,
      provider: LotteryRelationshipsRepository,
    },
    {
      modelName: LotteryWholesaleCustomer.name,
      provider: LotteryWholesaleCustomersRepository,
    },
    {
      modelName: LotteryWholesaleCustomerLock.name,
      provider: LotteryWholesaleCustomerLocksRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-dealers",
      modelName: LotteryDealer.name,
      repository: LotteryDealersRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-dealer-contacts",
      modelName: LotteryDealerContact.name,
      repository: LotteryDealerContactsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-dealer-signins",
      modelName: LotteryDealerSignin.name,
      repository: LotteryDealerSigninsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-relationships",
      modelName: LotteryRelationship.name,
      repository: LotteryRelationshipsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-wholesale-customers",
      modelName: LotteryWholesaleCustomer.name,
      repository: LotteryWholesaleCustomersRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-wholesale-customer-locks",
      modelName: LotteryWholesaleCustomerLock.name,
      repository: LotteryWholesaleCustomerLocksRepository,
      ownerField: "orgId",
    },
  ],
};
