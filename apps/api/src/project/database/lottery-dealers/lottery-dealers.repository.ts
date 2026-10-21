import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryDealerContact } from "./lottery-dealer-contact.schema";
import { LotteryDealerSignin } from "./lottery-dealer-signin.schema";
import { LotteryDealer } from "./lottery-dealer.schema";
import { LotteryRelationship } from "./lottery-relationship.schema";

export type LotteryDealerDocument = HydratedDocument<LotteryDealer>;
export type LotteryDealerContactDocument =
  HydratedDocument<LotteryDealerContact>;
export type LotteryDealerSigninDocument = HydratedDocument<LotteryDealerSignin>;
export type LotteryRelationshipDocument = HydratedDocument<LotteryRelationship>;

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
