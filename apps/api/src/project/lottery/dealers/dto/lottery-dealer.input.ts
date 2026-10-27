import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

import { ShareOrgInput } from "../../../../sharing/share-org.model";
import {
  LotteryDealerStatusEnum,
  LotteryDealerTypeEnum,
  LotteryLicenseStateEnum,
  LotteryRentCycleEnum,
} from "../models/lottery-dealer.model";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 經銷商清單(甲類 / 乙類分頁各查一次)。範圍由 `tenantScopePlugin` 套可見範圍,這裡只收窄。
 * 關鍵字比對證號、姓名、店名、身分證字號;**不比對兩個批購基準日**(欄位級權限欄)。
 */
@InputType()
export class LotteryDealersInput {
  @Field(() => LotteryDealerTypeEnum)
  type!: LotteryDealerTypeEnum;

  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => LotteryDealerStatusEnum, { nullable: true })
  status?: LotteryDealerStatusEnum | null;

  /** 只列可以被選的(排除解約的);挑選器用。 */
  @Field(() => Boolean, { nullable: true })
  selectable?: boolean | null;

  /** 甲類:最近一次批購日或本人批購日距今超過幾天(快速篩選「逾 150 天」「逾 180 天」)。 */
  @Field(() => Int, { nullable: true })
  purchaseOverDays?: number | null;

  /** 甲類:本季已見簽(true)/ 本季未見簽(false)。 */
  @Field(() => Boolean, { nullable: true })
  currentQuarterSigned?: boolean | null;

  /** 證照:`EXPIRING` = 30 天內到期(不含已過期)、`EXPIRED` = 已過期、`OK` = 其他。 */
  @Field(() => LotteryLicenseStateEnum, { nullable: true })
  licenseState?: LotteryLicenseStateEnum | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/**
 * 經銷商的可寫欄位(新增 / 編輯共用的形狀)。缺席 / `null` 語意見各 input 的註解。
 * 關聯(共同銷售處所、代理人、受託人、介紹人、對應分店)與主檔在同一個交易裡存。
 */
@InputType({ isAbstract: true })
abstract class LotteryDealerFieldsInput {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => LotteryDealerStatusEnum, { nullable: true })
  status?: LotteryDealerStatusEnum | null;

  @Field(() => String, { nullable: true })
  licenseNo?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  licenseApprovedAt?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  licenseExpiresAt?: Date | null;

  /** 甲類;欄位級權限(見「api 介面」)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastPurchaseBaseDate?: Date | null;

  /** 甲類;欄位級權限(見「api 介面」)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastSelfPurchaseBaseDate?: Date | null;

  /** 甲類:共同銷售處所(乙類 id)。 */
  @Field(() => ID, { nullable: true })
  coSalesDealerId?: string | null;

  /** 代理人(關係人 id;甲類要先有共同銷售處所)。 */
  @Field(() => [ID], { nullable: true })
  agentIds?: string[] | null;

  /** 受託人(甲類才有)。 */
  @Field(() => [ID], { nullable: true })
  trusteeIds?: string[] | null;

  @Field(() => [ID], { nullable: true })
  introducerIds?: string[] | null;

  /** 乙類:對應分店(租戶底下的組織,一對一)。 */
  @Field(() => ID, { nullable: true })
  storeOrgId?: string | null;

  @Field(() => String, { nullable: true })
  storeName?: string | null;

  @Field(() => String, { nullable: true })
  businessAddress?: string | null;

  @Field(() => String, { nullable: true })
  storePhone?: string | null;

  @Field(() => String, { nullable: true })
  terminalNo?: string | null;

  @Field(() => Int, { nullable: true })
  rentFee?: number | null;

  @Field(() => LotteryRentCycleEnum, { nullable: true })
  rentCycle?: LotteryRentCycleEnum | null;

  @Field(() => Int, { nullable: true })
  rentStartMonth?: number | null;

  @Field(() => Int, { nullable: true })
  rentDueDay?: number | null;

  @Field(() => String, { nullable: true })
  nationalId?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  birthday?: Date | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  mobile?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  mailingAddress?: string | null;

  @Field(() => String, { nullable: true })
  residentialAddress?: string | null;

  @Field(() => Boolean, { nullable: true })
  residentialSameAsMailing?: boolean | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /**
   * 共用給(資料共用,ADR-0014):整份清單;要有 `dealers.edit`(沒有 → `FORBIDDEN`)。
   * 組織要在同一個租戶(可以是自己看不到的),否則 `VALIDATION_FAILED`(fields: ["shareOrgs"])。
   * 新增:缺席 / `null` = 不共用;編輯:缺席 = 不動、`[]` = 不共用、`null` → `VALIDATION_FAILED`。
   */
  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}

/**
 * 新增經銷商(需 `dealers.create`)。必填:類型、證號、姓名、證照核准日 / 到期日、身分證字號。
 * 選填欄位缺席與 `null` 同義(沒有東西可清);兩個批購基準日送 `null` 視同缺席、不要求權限(GQL-06 先例)。
 */
@InputType()
export class CreateLotteryDealerInput extends LotteryDealerFieldsInput {
  @Field(() => LotteryDealerTypeEnum)
  type!: LotteryDealerTypeEnum;
}

/**
 * 編輯經銷商(需 `dealers.edit`;類型不能改)。**缺席 = 不動、`null` = 清空**;必填欄位送 `null` 視同缺席。
 * 關聯清單送 `[]` = 全部解除。兩個批購基準日**只要出現**(含 `null`)就要對應的 `edit-` 權限。
 */
@InputType()
export class UpdateLotteryDealerInput extends LotteryDealerFieldsInput {
  @Field(() => ID)
  id!: string;

  /** 移除共同銷售處所但還有代理人時:true = 一併解除代理人;沒給 → `CONFLICT`(列出代理人)。 */
  @Field(() => Boolean, { nullable: true })
  releaseAgents?: boolean | null;
}

/** 登記見簽(需 `dealers.edit`)。 */
@InputType()
export class RegisterLotteryDealerSigninInput {
  @Field(() => ID)
  dealerId!: string;

  @Field(() => Int)
  year!: number;

  @Field(() => Int)
  quarter!: number;

  @Field(() => GraphQLISODateTime)
  signedAt!: Date;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 修改見簽(需 `dealers.edit`):缺席 = 不動;`note: null` = 清空。 */
@InputType()
export class UpdateLotteryDealerSigninInput {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  signedAt?: Date | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
