import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { ClientSession, HydratedDocument, Types } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import {
  type OperatorContext,
  scopeQuery,
} from "../../../database/operator-context";
import { LotteryDealerContact } from "./lottery-dealer-contact.schema";
import { LotteryDealerSignin } from "./lottery-dealer-signin.schema";
import { LotteryDealer } from "./lottery-dealer.schema";
import { LotteryRelationship } from "./lottery-relationship.schema";
import { LotteryWholesaleCustomer } from "./lottery-wholesale-customer.schema";

export type LotteryDealerDocument = HydratedDocument<LotteryDealer>;
export type LotteryDealerContactDocument =
  HydratedDocument<LotteryDealerContact>;
export type LotteryDealerSigninDocument = HydratedDocument<LotteryDealerSignin>;
export type LotteryRelationshipDocument = HydratedDocument<LotteryRelationship>;
export type LotteryWholesaleCustomerDocument =
  HydratedDocument<LotteryWholesaleCustomer>;

/** lottery_dealers(經銷商)。 */
@Injectable()
export class LotteryDealersRepository extends BaseRepository<
  LotteryDealer,
  LotteryDealerDocument
> {
  constructor(
    @InjectModel(LotteryDealer.name)
    model: RepositoryModel<LotteryDealer, LotteryDealerDocument>,
  ) {
    super(model);
  }
}

/** lottery_dealer_contacts(關係人)。 */
@Injectable()
export class LotteryDealerContactsRepository extends BaseRepository<
  LotteryDealerContact,
  LotteryDealerContactDocument
> {
  constructor(
    @InjectModel(LotteryDealerContact.name)
    model: RepositoryModel<LotteryDealerContact, LotteryDealerContactDocument>,
  ) {
    super(model);
  }
}

/** lottery_dealer_signins(見簽)。 */
@Injectable()
export class LotteryDealerSigninsRepository extends BaseRepository<
  LotteryDealerSignin,
  LotteryDealerSigninDocument
> {
  constructor(
    @InjectModel(LotteryDealerSignin.name)
    model: RepositoryModel<LotteryDealerSignin, LotteryDealerSigninDocument>,
  ) {
    super(model);
  }
}

/** lottery_relationships(刮刮樂的關聯)。 */
@Injectable()
export class LotteryRelationshipsRepository extends BaseRepository<
  LotteryRelationship,
  LotteryRelationshipDocument
> {
  constructor(
    @InjectModel(LotteryRelationship.name)
    model: RepositoryModel<LotteryRelationship, LotteryRelationshipDocument>,
  ) {
    super(model);
  }
}

/** lottery_wholesale_customers(批售客戶)。 */
@Injectable()
export class LotteryWholesaleCustomersRepository extends BaseRepository<
  LotteryWholesaleCustomer,
  LotteryWholesaleCustomerDocument
> {
  constructor(
    @InjectModel(LotteryWholesaleCustomer.name)
    model: RepositoryModel<
      LotteryWholesaleCustomer,
      LotteryWholesaleCustomerDocument
    >,
  ) {
    super(model);
  }

  /**
   * 批售單送出時在同一個交易裡碰客戶(`referenceVersion` +1):和「刪除客戶」互相衝突(兩邊都寫同一筆)。
   * 不是修改客戶資料:修改者照原值、修改時間不動。客戶讀不到(已刪除)→ 不做事(送出前檢查已擋)。
   */
  async touchReference(
    operator: OperatorContext,
    id: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const current = await this.findById(operator, id, {
      select: "updatedBy",
      session,
    });
    if (current === null) {
      return;
    }
    await scopeQuery(
      this.model.updateOne(
        { _id: id },
        { $inc: { referenceVersion: 1 } },
        { timestamps: false },
      ),
      { operator: { ...operator, actorId: current.updatedBy ?? null } },
    )
      .session(session)
      .exec();
  }
}
