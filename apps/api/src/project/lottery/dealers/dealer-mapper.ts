import type { Types } from "mongoose";

import { startOfLocalDay } from "@repo/domain/form";

import type { Persisted } from "../../../database/base.repository";
import { toShareOrgModels } from "../../../sharing/share-org.model";
import type {
  LotteryDealerContactDocument,
  LotteryDealerDocument,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import { daysSince, licenseStateOf, nextRentDueDate } from "./dealer-dates";
import { DEALERS_PERMISSIONS } from "./dealer-keys";
import { type DealerLinks, emptyLinks } from "./dealer-links.service";
import type { DealersGrant } from "./dealers-access";
import type {
  LotteryContactStatusEnum,
  LotteryDealerContactRef,
  LotteryDealerModel,
  LotteryDealerRef,
  LotteryDealerStatusEnum,
  LotteryDealerTypeEnum,
  LotteryDealerUserRef,
  LotteryLicenseStateEnum,
  LotteryRentCycleEnum,
} from "./models/lottery-dealer.model";

export type DealerRecord = Persisted<LotteryDealerDocument>;
export type ContactRecord = Persisted<LotteryDealerContactDocument>;

/** 一次查好、整批列共用的對照(不逐列查)。 */
export interface DealerViewContext {
  grant: DealersGrant;
  links: ReadonlyMap<string, DealerLinks>;
  /** 經銷商 id → 參照(共同銷售處所用)。 */
  dealerRefs: ReadonlyMap<string, LotteryDealerRef>;
  /** 關係人 id → 參照。 */
  contactRefs: ReadonlyMap<string, LotteryDealerContactRef>;
  /** 組織 id → 名稱(對應分店、所屬組織)。 */
  orgNames: ReadonlyMap<string, string>;
  /** 乙類 id → 共同銷售人數。 */
  coSellerCounts: ReadonlyMap<string, number>;
  /** 本季已見簽的甲類 id。 */
  signedThisQuarter: ReadonlySet<string>;
  /** 使用者 id → 名稱(建立者、修改者)。 */
  users: ReadonlyMap<string, string>;
  /** 這個組織在讀者的可見範圍內嗎(歸屬組織看得到 = 自己的;否則是共用進來的,只能看)。 */
  owns: (orgId: Types.ObjectId) => boolean;
}

export function dealerRefOf(record: DealerRecord): LotteryDealerRef {
  return {
    id: String(record._id),
    type: record.type as LotteryDealerTypeEnum,
    licenseNo: record.licenseNo,
    name: record.name,
    storeName: record.storeName,
    status: record.status as LotteryDealerStatusEnum,
  };
}

/** 建立者 / 修改者(`createdBy` / `updatedBy`)的參照;沒有記錄操作者為 null。 */
export function userRefOf(
  id: Types.ObjectId | null,
  users: ReadonlyMap<string, string>,
): LotteryDealerUserRef | null {
  return id === null
    ? null
    : { id: String(id), name: users.get(String(id)) ?? "" };
}

export function contactRefOf(record: ContactRecord): LotteryDealerContactRef {
  return {
    id: String(record._id),
    name: record.name,
    status: record.status as LotteryContactStatusEnum,
  };
}

/**
 * 一筆經銷商的對外形狀。
 *
 * **兩個批購基準日的「欄位缺席」**:沒有 `show-` 權限時不把鍵放進物件(GraphQL 序列化成 null),
 * 列表與單筆一致;前端依權限集決定渲染與否(module-scaffold「欄位級權限欄的四件事」第 1 件)。
 */
export function toDealerModel(
  record: DealerRecord,
  context: DealerViewContext,
): LotteryDealerModel {
  const { grant } = context;
  const isClassA = record.type === "a";
  const owned = context.owns(record.orgId);
  const links = context.links.get(String(record._id)) ?? emptyLinks();
  const refsOf = (ids: readonly { toString(): string }[]) =>
    ids.flatMap((id) => {
      const ref = context.contactRefs.get(String(id));
      return ref === undefined ? [] : [ref];
    });
  const rent =
    record.rentCycle === null || record.rentDueDay === null
      ? null
      : {
          cycle: record.rentCycle,
          startMonth: record.rentStartMonth,
          dueDay: record.rentDueDay,
        };
  const nextDue = rent === null ? null : nextRentDueDate(grant.today, rent);
  return {
    id: String(record._id),
    type: record.type as LotteryDealerTypeEnum,
    licenseNo: record.licenseNo,
    name: record.name,
    status: record.status as LotteryDealerStatusEnum,
    licenseApprovedAt: record.licenseApprovedAt,
    licenseExpiresAt: record.licenseExpiresAt,
    licenseState: licenseStateOf(
      record.licenseExpiresAt,
      grant.today,
      grant.timezone,
    ) as LotteryLicenseStateEnum,
    coSalesDealer:
      links.coSalesDealerId === null
        ? null
        : (context.dealerRefs.get(String(links.coSalesDealerId)) ?? null),
    agents: refsOf(links.contacts.agent),
    trustees: refsOf(links.contacts.trustee),
    introducers: refsOf(links.contacts.introducer),
    ...(grant.has(DEALERS_PERMISSIONS.showLastPurchaseBaseDate)
      ? { lastPurchaseBaseDate: record.lastPurchaseBaseDate }
      : {}),
    ...(grant.has(DEALERS_PERMISSIONS.showLastSelfPurchaseBaseDate)
      ? { lastSelfPurchaseBaseDate: record.lastSelfPurchaseBaseDate }
      : {}),
    lastPurchaseDate: record.lastPurchaseDate,
    lastSelfPurchaseDate: record.lastSelfPurchaseDate,
    daysSinceLastPurchase: daysSince(
      record.lastPurchaseDate,
      grant.today,
      grant.timezone,
    ),
    daysSinceLastSelfPurchase: daysSince(
      record.lastSelfPurchaseDate,
      grant.today,
      grant.timezone,
    ),
    currentQuarterSigned: isClassA
      ? context.signedThisQuarter.has(String(record._id))
      : null,
    storeOrg:
      links.storeOrgId === null
        ? null
        : {
            id: String(links.storeOrgId),
            name: context.orgNames.get(String(links.storeOrgId)) ?? "",
          },
    storeName: record.storeName,
    businessAddress: record.businessAddress,
    storePhone: record.storePhone,
    terminalNo: record.terminalNo,
    coSellerCount: isClassA
      ? null
      : (context.coSellerCounts.get(String(record._id)) ?? 0),
    rentFee: record.rentFee,
    rentCycle: record.rentCycle as LotteryRentCycleEnum | null,
    rentStartMonth: record.rentStartMonth,
    rentDueDay: record.rentDueDay,
    nextRentDueAt:
      nextDue === null
        ? null
        : new Date(startOfLocalDay(nextDue, grant.timezone)),
    nationalId: record.nationalId,
    birthday: record.birthday,
    phone: record.phone,
    mobile: record.mobile,
    email: record.email,
    mailingAddress: record.mailingAddress,
    residentialAddress: record.residentialAddress,
    residentialSameAsMailing: record.residentialSameAsMailing,
    note: record.note,
    createdBy: userRefOf(record.createdBy, context.users),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: userRefOf(record.updatedBy, context.users),
    ownerOrgName: context.orgNames.get(String(record.orgId)) ?? null,
    shareOrgs: toShareOrgModels(record.shareOrgs),
    isShared: !owned,
    // 共用進來的只能看(ADR-0014):三個編輯能力都是 false
    abilities: {
      canEdit: owned && grant.has(DEALERS_PERMISSIONS.edit),
      canEditLastPurchaseBaseDate:
        owned &&
        isClassA &&
        grant.has(DEALERS_PERMISSIONS.editLastPurchaseBaseDate),
      canEditLastSelfPurchaseBaseDate:
        owned &&
        isClassA &&
        grant.has(DEALERS_PERMISSIONS.editLastSelfPurchaseBaseDate),
    },
  };
}
