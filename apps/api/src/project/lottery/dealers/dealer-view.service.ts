import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  LotteryDealerContactsRepository,
  LotteryDealerSigninsRepository,
  LotteryDealersRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import { quarterOf } from "./dealer-dates";
import {
  CONTACT_ROLES_IN_ORDER,
  DealerLinksService,
} from "./dealer-links.service";
import {
  type DealerRecord,
  type DealerViewContext,
  toDealerModel,
} from "./dealer-mapper";
import { dealerRefFrom } from "./dealer-tenant";
import type { DealersGrant } from "./dealers-access";
import type {
  LotteryDealerContactRef,
  LotteryDealerModel,
} from "./models/lottery-dealer.model";

const uniqueIds = (ids: readonly Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(ids.map((id) => [String(id), id])).values(),
];

/**
 * 經銷商的對外形狀需要的對照(關聯、參照名稱、共同銷售人數、本季見簽、建立者),一批列一次查完。
 * 參照名稱(共同銷售處所、關係人、對應分店)以租戶為邊界讀:看得到這位經銷商就看得到它掛的名字。
 */
@Injectable()
export class DealerViewService {
  constructor(
    private readonly dealers: LotteryDealersRepository,
    private readonly contacts: LotteryDealerContactsRepository,
    private readonly signins: LotteryDealerSigninsRepository,
    private readonly links: DealerLinksService,
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
  ) {}

  async toModels(
    operator: OperatorContext,
    grant: DealersGrant,
    records: readonly DealerRecord[],
  ): Promise<LotteryDealerModel[]> {
    const context = await this.contextOf(operator, grant, records);
    return records.map((record) => toDealerModel(record, context));
  }

  async contextOf(
    operator: OperatorContext,
    grant: DealersGrant,
    records: readonly DealerRecord[],
  ): Promise<DealerViewContext> {
    const ids = records.map((record) => record._id);
    const links = await this.links.linksOf(operator, grant.tenantId, ids);
    const linkValues = [...links.values()];
    const coSalesIds = uniqueIds(
      linkValues.flatMap((link) =>
        link.coSalesDealerId === null ? [] : [link.coSalesDealerId],
      ),
    );
    const contactIds = uniqueIds(
      linkValues.flatMap((link) =>
        CONTACT_ROLES_IN_ORDER.flatMap((role) => link.contacts[role]),
      ),
    );
    const orgIds = [
      ...linkValues.flatMap((link) =>
        link.storeOrgId === null ? [] : [link.storeOrgId],
      ),
      ...records.map((record) => record.orgId),
    ];
    const classA = records.filter((record) => record.type === "a");
    const classB = records.filter((record) => record.type === "b");

    // 看得到經銷商就看得到它引用的名稱(共同銷售處所、關係人;租戶內引用名稱出口)
    const tenantId = grant.tenantId;
    const coSalesDealers =
      coSalesIds.length === 0 || tenantId === null
        ? []
        : await this.dealers.findRefsInTenant(operator, tenantId, coSalesIds);
    const contacts =
      contactIds.length === 0 || tenantId === null
        ? []
        : await this.contacts.findRefsInTenant(operator, tenantId, contactIds);
    const orgNames = await this.orgNames(operator, tenantId, orgIds);
    const coSellers =
      classB.length === 0
        ? []
        : await this.links.coSellerRows(
            operator,
            grant.tenantId,
            classB.map((record) => record._id),
          );
    const signed =
      classA.length === 0
        ? []
        : await this.signins.findMany(operator, {
            dealerId: { $in: classA.map((record) => record._id) },
            year: grant.today.year,
            quarter: quarterOf(grant.today),
          });
    const users = await this.userNames(
      operator,
      records.flatMap((record) => [record.createdBy, record.updatedBy]),
    );

    const coSellerCounts = new Map<string, number>();
    for (const row of coSellers) {
      const key = String(row.secondId);
      coSellerCounts.set(key, (coSellerCounts.get(key) ?? 0) + 1);
    }
    return {
      grant,
      links,
      dealerRefs: new Map(
        coSalesDealers.map((dealer) => [
          String(dealer._id),
          dealerRefFrom(dealer),
        ]),
      ),
      contactRefs: new Map(
        contacts.map((contact) => [
          String(contact._id),
          {
            id: String(contact._id),
            name: typeof contact.name === "string" ? contact.name : "",
            status: contact.status as LotteryDealerContactRef["status"],
          },
        ]),
      ),
      orgNames,
      coSellerCounts,
      signedThisQuarter: new Set(signed.map((row) => String(row.dealerId))),
      users,
      owns: (orgId) => isOrgVisible(operator, orgId),
    };
  }

  /**
   * 組織 id → 名稱(對應分店、所屬組織)。組織可能不在讀者的可見範圍(對應分店、共用進來的),
   * 以租戶的組織樹讀:看得到這筆資料就看得到它掛的組織名稱。
   */
  async orgNames(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) {
      return new Map();
    }
    const found = await this.orgs.findMany(
      await tenantBoundaryContext(this.orgs, operator, tenantId),
      { _id: { $in: unique } },
    );
    return new Map(found.map((org) => [String(org._id), org.name]));
  }

  /** 使用者 id → 名稱(建立者、修改者)。 */
  async userNames(
    operator: OperatorContext,
    ids: readonly (Types.ObjectId | null)[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids.filter((id) => id !== null));
    if (unique.length === 0) {
      return new Map();
    }
    const found = await this.users.findMany(operator, {
      _id: { $in: unique.map((id) => new Types.ObjectId(String(id))) },
    });
    return new Map(found.map((user) => [String(user._id), user.name]));
  }
}
