import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { FormSubmissionStatusEnum } from "../../../../forms/form-runtime/models/form-submission.model";

/** 一頁預設 / 最多幾筆。 */
export const WHOLESALE_PAGE_SIZE = 20;
export const WHOLESALE_MAX_PAGE_SIZE = 100;

/** 選項(id + 顯示文字)。 */
@ObjectType("LotteryWholesaleOption")
export class LotteryWholesaleOptionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  label!: string;
}

/** 新增頁可以批售的一本(出貨分店庫存裡未拆、沒被鎖的整本)。 */
@ObjectType("LotteryWholesaleBook")
export class LotteryWholesaleBookModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 張數(遊戲的標準張數;待標註的跳號不算)。 */
  @Field(() => Int)
  tickets!: number;

  @Field(() => Int)
  bookPrice!: number;

  /** 遊戲的預設批購金額率(批購金額率的預設值)。 */
  @Field(() => Int)
  defaultRate!: number;

  /** 原成本(這本現在的單張成本合計,四捨五入到元);沒有 `inventory.show-cost` = null。 */
  @Field(() => Int, { nullable: true })
  cost!: number | null;
}

/** 新增 / 編輯頁的選項(規格 21.3)。 */
@ObjectType("LotteryWholesaleOptions")
export class LotteryWholesaleOptionsModel {
  /** 可批售的本。 */
  @Field(() => [LotteryWholesaleBookModel])
  books!: LotteryWholesaleBookModel[];

  /** 往來中、操作者讀得到的批售客戶(文字「店名 · 電話」)。 */
  @Field(() => [LotteryWholesaleOptionModel])
  customers!: LotteryWholesaleOptionModel[];

  /** 入帳帳戶:使用中、使用組織包含出貨分店、操作者看得到的。 */
  @Field(() => [LotteryWholesaleOptionModel])
  accounts!: LotteryWholesaleOptionModel[];
}

/** 刷到的碼對到的一本,與它為什麼不能批售。 */
@ObjectType("LotteryWholesaleScanMatch")
export class LotteryWholesaleScanMatchModel {
  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  /**
   * `revoked` 已撤銷 / `wholesaled` 已批售 / `opened` 拆過了 / `elsewhere` 在別家店 / `transferring` 調貨中 /
   * `wholesaling` 批售中 / `locked` 被其他來源鎖住 / `not_in_stock` 有張不是未售在庫存;null = 可以批售。
   */
  @Field(() => String, { nullable: true })
  problem!: string | null;

  /** 調貨中 / 批售中:鎖住它的那張單的單號。 */
  @Field(() => String, { nullable: true })
  lockedSerialNo!: string | null;
}

/** 列表的篩選(規格 21.3「列表」)。 */
@InputType()
export class LotteryWholesalesInput {
  @Field(() => Int, { nullable: true })
  page?: number | null;

  @Field(() => Int, { nullable: true })
  pageSize?: number | null;

  /** 狀態(含草稿) */
  @Field(() => FormSubmissionStatusEnum, { nullable: true })
  status?: FormSubmissionStatusEnum | null;

  /** 出貨分店 */
  @Field(() => ID, { nullable: true })
  fromOrgId?: string | null;

  /** 批售客戶 */
  @Field(() => ID, { nullable: true })
  customerId?: string | null;

  /** 收款方式(`auto_bank` / `collect_first`) */
  @Field(() => String, { nullable: true })
  paymentMode?: string | null;
}

/** 批售單的一列(列表)。 */
@ObjectType("LotteryWholesale")
export class LotteryWholesaleModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 出貨分店名稱(單上的值)。 */
  @Field(() => String)
  fromBranchName!: string;

  /** 批售客戶的店名。 */
  @Field(() => String)
  customerName!: string;

  /** 收款方式;草稿還沒選 = null。 */
  @Field(() => String, { nullable: true })
  paymentMode!: string | null;

  /** 本數。 */
  @Field(() => Int)
  books!: number;

  /** 批售金額。 */
  @Field(() => Int)
  amount!: number;

  /** 已收淨額(草稿、核准前的從帳戶入帳 = 0)。 */
  @Field(() => Int)
  received!: number;

  /** 結算:`to_receive` 待收 / `to_refund` 待退;已結清或不參與收付 = null。 */
  @Field(() => String, { nullable: true })
  settlementKind!: string | null;

  @Field(() => Int)
  settlementAmount!: number;

  /** 參與收付(收到錢再核准 = 送出之後;從帳戶入帳 = 已完成)。 */
  @Field(() => Boolean)
  inSettlement!: boolean;

  @Field(() => FormSubmissionStatusEnum)
  status!: FormSubmissionStatusEnum;

  /** 找不到審核者(同表單列表)。 */
  @Field(() => Boolean)
  blocked!: boolean;

  /** 這筆自己的草稿可以刪(列表的 [刪除])。 */
  @Field(() => Boolean)
  canDelete!: boolean;
}

@ObjectType("LotteryWholesalesPayload")
export class LotteryWholesalesPayload {
  @Field(() => [LotteryWholesaleModel])
  items!: LotteryWholesaleModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 檢視頁的一列(一整本)。 */
@ObjectType("LotteryWholesaleRow")
export class LotteryWholesaleRowModel {
  @Field(() => String)
  rowId!: string;

  @Field(() => ID)
  bookId!: string;

  @Field(() => ID)
  gameId!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 7 位本號(顯示時開頭 0 去掉)。 */
  @Field(() => String)
  bookNo!: string;

  @Field(() => Int)
  unitPrice!: number;

  /** 遊戲的預設批購金額率(編輯頁標出改過的率)。 */
  @Field(() => Int)
  defaultRate!: number;

  @Field(() => Int)
  tickets!: number;

  @Field(() => Int)
  bookPrice!: number;

  @Field(() => Int)
  rate!: number;

  @Field(() => Int)
  amount!: number;

  /** `wholesaling` 批售中(審核中)/ `wholesaled` 已批售(已完成);其他狀態 = null。 */
  @Field(() => String, { nullable: true })
  state!: string | null;
}

/** 檢視頁 / 申請中心詳情頁的批售單內容(規格 21.3)。 */
@ObjectType("LotteryWholesaleDetail")
export class LotteryWholesaleDetailModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String)
  fromBranchName!: string;

  /** 批售客戶的店名。 */
  @Field(() => String)
  customerName!: string;

  @Field(() => String, { nullable: true })
  paymentMode!: string | null;

  /** 入帳帳戶名稱(從帳戶入帳);收到錢再核准 = null。 */
  @Field(() => String, { nullable: true })
  accountLabel!: string | null;

  /** 批售金額。 */
  @Field(() => Int)
  amount!: number;

  /** 已收淨額(不參與收付的狀態 = 0)。 */
  @Field(() => Int)
  received!: number;

  /** 出貨時間(批售事件的時間);還沒出貨 = null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  shippedAt!: Date | null;

  @Field(() => [LotteryWholesaleRowModel])
  rows!: LotteryWholesaleRowModel[];
}
